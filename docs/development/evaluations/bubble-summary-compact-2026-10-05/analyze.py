"""Recompute usage and explicit downstream-format checks. These are not semantic grades."""
import json
import re
from collections import Counter
from pathlib import Path
from statistics import mean

root = Path(__file__).resolve().parent
records = json.loads((root / 'api-results.json').read_text())

def style(record):
    text = record.get('output', '').strip()
    case = record['case_id']
    if not record.get('condition', '').startswith('follow-') or not text:
        return {}
    paragraphs = len(re.split(r'\n\s*\n', text))
    bullets = len(re.findall(r'^\s*[-*+]\s', text, re.M))
    headings = bool(re.search(r'^\s*#{1,6}\s|^\*\*[^\n]+\*\*\s*$', text, re.M))
    checks = {}
    if case in ['T01', 'T13', 'T04', 'T12', 'H03']:
        checks['two_paragraphs'] = paragraphs == 2
    if case in ['T03', 'T11', 'A01']:
        checks['one_paragraph'] = paragraphs == 1
    if case in ['T02', 'T07', 'H04']:
        checks['bullet_count'] = bullets == {'T02': 3, 'T07': 4, 'H04': 2}[case]
    if case == 'T05':
        checks['max_200_characters'] = len(text) <= 200
    if case in ['T08', 'H02']:
        checks['two_sentences'] = text.count('。') == 2
    if case in ['A02', 'A03']:
        checks['two_sentences'] = len(re.findall(r'[.!?](?:\s|$)', text)) == 2
    if case in ['T04', 'H03', 'A02']:
        checks['english_contraction'] = bool(re.search(r"\b\w+['’]\w+\b", text))
    if case in ['T01', 'T13', 'T02', 'T03', 'T04', 'T05', 'T07', 'H03', 'H04', 'A03']:
        checks['no_heading'] = not headings
    if case in ['T01', 'T13', 'T03', 'T04', 'H02', 'H03', 'A02', 'A03']:
        checks['no_list'] = bullets == 0
    return checks

outputs = [r for r in records if r.get('usage')]
assert all(r['usage']['prompt_tokens'] >= 0 and r['usage']['completion_tokens'] >= 0 for r in outputs)
checks = [{'response_id': r.get('response_id'), 'phase': r['phase'], 'case_id': r['case_id'], 'repeat': r['repeat'], 'condition': r.get('condition'), 'model': r['config']['model'], 'temperature': r['config']['temperature'], 'reasoning_effort': r['config']['reasoning_effort'], 'finish_reason': r.get('finish_reason'), 'checks': style(r), 'judgment': '書式条件の機械確認のみ。意味・語調・物語の評価はmanual-review.mdを参照。途中終了は合格扱いしない。'} for r in outputs]
(root / 'format-checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')
phases = {}
for phase in sorted({r['phase'] for r in records}):
    rows = [r for r in records if r['phase'] == phase]
    used = [r for r in rows if r.get('usage')]
    phases[phase] = {'requests': len(rows), 'outputs': len(used), 'finish_reasons': dict(Counter(r.get('finish_reason', 'error') for r in rows)), 'actual_cost_usd': sum(r['usage'].get('cost', 0) for r in used), 'accounted_cost_usd': sum(r['accounted_cost'] for r in rows), 'prompt_tokens': sum(r['usage']['prompt_tokens'] for r in used), 'completion_tokens': sum(r['usage']['completion_tokens'] for r in used)}
comparison = []
for case in sorted({r['case_id'] for r in records if r['phase'] in ['compact-development', 'compact-v3-audit', 'compact-v3-holdout']}):
    baseline = 'compact-development' if case.startswith('T') else 'compact-v3-audit' if case.startswith('A') else 'compact-v3-holdout'
    final = 'compact-v3-development' if case.startswith('T') else baseline
    values = {}
    for label, phase, condition in [('original', baseline, 'follow-original'), ('readable', baseline, 'follow-readable'), ('compact_v1', baseline, 'follow-compact'), ('compact_final', final, 'follow-compact')]:
        rows = [r for r in outputs if r['case_id'] == case and r['phase'] == phase and r.get('condition') == condition]
        if rows and (label != 'compact_v1' or case.startswith('T')):
            assert len(rows) == 2, (case, phase, condition, len(rows))
            values[label] = mean(r['usage']['prompt_tokens'] for r in rows)
    comparison.append({'case_id': case, **values})
summary = {'schema': 1, 'cost_cap_usd': 10, 'requests': len(records), 'outputs': len(outputs), 'actual_cost_usd': sum(r['usage'].get('cost', 0) for r in outputs), 'accounted_cost_usd': sum(r['accounted_cost'] for r in records), 'phases': phases, 'paired_followup_input_tokens': comparison}
(root / 'metrics.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(summary, ensure_ascii=False, indent=2))
