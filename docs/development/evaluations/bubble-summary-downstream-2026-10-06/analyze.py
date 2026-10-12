"""Repeatable mechanical checks, not a semantic/style-quality verdict."""
import collections
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
filename = sys.argv[1] if len(sys.argv) > 1 else 'api-results.json'
records = json.loads((root / filename).read_text())
finished = [r for r in records if r.get('finish_reason') == 'stop' and r.get('usage')]
rows = []
for r in finished:
    if not r['condition'].startswith('follow-'):
        continue
    text = r['output'].strip()
    checks = {}
    if r['case_id'] in ['T01', 'T13']:
        checks['two_paragraphs'] = len(re.split(r'\n\s*\n', text)) == 2
    if r['case_id'] in ['T05', 'D01']:
        checks['character_limit'] = len(text) <= (200 if r['case_id'] == 'T05' else 90)
    if r['case_id'] in ['D02', 'D03', 'D05', 'D07']:
        checks['two_sentences'] = text.count('。') == 2
    if r['case_id'] == 'T06':
        try:
            # Keep fence observation separate: JSON request alone does not define fence policy.
            checks['result_null'] = json.loads(re.sub(r'^```(?:json)?\s*\n([\s\S]*?)\n```$', r'\1', text)) is None
        except ValueError:
            checks['result_null'] = False
    if r['case_id'] in ['T10', 'T14', 'D01', 'D04', 'D06']:
        checks['no_added_script_labels'] = not bool(re.search(r'(?:^|\n)(?:アキ|ユイ|ハル|ミオ|ケイ|ナオ)\s*[「：:]', text))
    if r['case_id'] in ['T01', 'T05', 'D01', 'D02', 'D03']:
        checks['no_markdown_heading'] = not bool(re.search(r'^\s*#{1,6}\s', text, re.M))
    rows.append({'case_id': r['case_id'], 'repeat': r['repeat'], 'condition': r['condition'], 'probe': r.get('probe'), 'characters': len(text), 'response_id': r['response_id'], 'checks': checks})

counts = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
for row in rows:
    for name, ok in row['checks'].items():
        c = counts[f"{row['case_id']} probe{row['probe']} {row['condition']}"][name]
        c[0] += int(ok)
        c[1] += 1
metrics = {'records': len(records), 'completed': len(finished), 'usage_prompt_tokens': sum(r['usage']['prompt_tokens'] for r in finished), 'usage_completion_tokens': sum(r['usage']['completion_tokens'] for r in finished), 'completed_usage_cost': sum(r['usage'].get('cost', 0) for r in finished), 'accounted_cost': sum(r.get('accounted_cost', 0) for r in records), 'checks': dict(counts), 'rows': rows}
(root / filename.replace('api-results', 'metrics')).write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in metrics.items() if k != 'rows'}, ensure_ascii=False, indent=2))
