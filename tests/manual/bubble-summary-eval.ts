import { buildBubbleSummaryPrompt as rebuildExplicitUnknown } from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/candidate7-bubbleSummaryPrompt';
import { candidateSubmitMessage as groundedSubmitMessage } from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/candidate4-bubbleSummarySubmitMessage';
import { buildBubbleSummaryPrompt as rebuildWithoutExamples } from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/candidate6-bubbleSummaryPrompt';
import rebuildRepair from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/repair-cases.json';
import { buildBubbleSummaryPrompt as rebuildBeforeRepair } from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/candidate3-bubbleSummaryPrompt';
import rebuildLayoutHoldout from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/layout-holdout-cases.json';
import rebuildFinalHoldout from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/final-holdout-cases.json';
import { candidateSubmitMessage as explicitStyleSubmitMessage } from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/candidate3-bubbleSummarySubmitMessage';
import { buildBubbleSummaryPrompt as rebuildCandidate1 } from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/candidate1-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as rebuildCandidate2 } from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/candidate2-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as rebuildCandidate4 } from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/candidate4-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as rebuildCandidate5 } from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/candidate5-bubbleSummaryPrompt';
import { candidateSubmitMessage as rebuildSubmitMessage } from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/candidate-bubbleSummarySubmitMessage';
import rebuildDevelopment from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/development-cases.json';
import rebuildHoldout from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/holdout-cases.json';
import rebuildCorpus from '../../docs/development/evaluations/bubble-summary-rebuild-2026-10-06/ablation-cases.json';
import { buildBubbleSummaryPrompt as downstreamCandidate5 } from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/candidate5-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as downstreamCandidate4 } from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/candidate4-bubbleSummaryPrompt';
import downstreamCorpus4 from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/cases-v4.json';
import countTokens, { loadEncoder } from '../../src/utils/messageUtils';
import { buildBubbleSummaryPrompt as downstreamCandidate3 } from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/candidate3-bubbleSummaryPrompt';
import { candidateSubmitMessage } from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/candidate-bubbleSummarySubmitMessage';
import downstreamCorpus3 from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/cases-v3.json';
import { buildBubbleSummaryPrompt as downstreamCandidate2 } from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/candidate2-bubbleSummaryPrompt';
import downstreamCorpus2 from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/cases-v2.json';
import { buildBubbleSummaryPrompt as downstreamBaseline } from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/baseline-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as downstreamCandidate } from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/candidate-bubbleSummaryPrompt';
import downstreamCorpus from '../../docs/development/evaluations/bubble-summary-downstream-2026-10-06/cases.json';
import { buildBubbleSummaryPrompt as extremePrompt } from '../../docs/development/evaluations/bubble-summary-extreme-2026-10-06/candidate-bubbleSummaryPrompt';
// Manual, dev-server-only experiment. Never include real chat content or credentials in records.
import store from '../../src/store/store';
import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import { getChatCompletion } from '../../src/api/api';
import { buildBubbleSummaryPrompt } from '../../src/utils/bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as baselinePrompt } from '../../docs/development/evaluations/bubble-summary-2026-10-05/baseline-bubbleSummaryPrompt';
import { applyBubbleSummariesForSubmit as compactV2Replacement } from '../../docs/development/evaluations/bubble-summary-compact-2026-10-05/compact-v2-bubbleSummary';
import { applyBubbleSummariesForSubmit } from '../../src/utils/bubbleSummary';
import { applyBubbleSummariesForSubmit as legacyReplacement } from '../../docs/development/evaluations/bubble-summary-2026-10-05/baseline-bubbleSummary';
import { buildBubbleSummaryPrompt as trial5Prompt } from '../../docs/development/evaluations/bubble-summary-2026-10-05/candidate5-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as trial1Prompt } from '../../docs/development/evaluations/bubble-summary-2026-10-05/candidate1-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as trial2Prompt } from '../../docs/development/evaluations/bubble-summary-2026-10-05/candidate2-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as trial3Prompt } from '../../docs/development/evaluations/bubble-summary-2026-10-05/candidate3-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as trial4Prompt } from '../../docs/development/evaluations/bubble-summary-2026-10-05/candidate4-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as main472Prompt } from '../../docs/development/evaluations/bubble-summary-2026-10-05/main472-bubbleSummaryPrompt';
const phasePrompts = { candidate: trial1Prompt, candidate2: trial2Prompt, candidate3: trial3Prompt, candidate4: trial4Prompt, candidate5: trial5Prompt, holdout: trial5Prompt, main472: main472Prompt } as Record<string, typeof buildBubbleSummaryPrompt>;
import { hardOpenRouterConstraints } from '../../src/utils/openrouterControls';
import corpus from '../fixtures/bubble-summary-prompt-cases.json';
import compactCorpus from '../fixtures/bubble-summary-compact-cases.json';
import { buildBubbleSummaryPrompt as compactV5 } from '../../docs/development/evaluations/bubble-summary-compact-2026-10-05/compact-v5-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as compactV3 } from '../../docs/development/evaluations/bubble-summary-compact-2026-10-05/compact-v3-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as compactV2 } from '../../docs/development/evaluations/bubble-summary-compact-2026-10-05/compact-v2-bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as compactV1 } from '../../docs/development/evaluations/bubble-summary-compact-2026-10-05/compact-v1-bubbleSummaryPrompt';
import type { ChatInterface, ConfigInterface, MessageInterface } from '../../src/types/chat';

const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
const evaluationVersion = (phase: string) => {
  const source = phase.replace('downstream-', '');
  const prompt = source === 'baseline' ? 'baseline' : source === 'candidate' ? 'candidate1' : source === 'free' || source === 'holdout' ? 'candidate5' : source;
  return { prompt_snapshot: `${prompt}-bubbleSummaryPrompt.ts`, base_commit: source === 'main472' ? '81f86947a8ced3fc731931f79ce380ade5c83b16' : '47cab4f9e18be1bdbcabf62904bc4c1f20e6384b', ...(phase.startsWith('downstream') ? { history_replacement: source === 'main472' ? 'src/utils/bubbleSummary.ts at 81f8694' : 'baseline-bubbleSummary.ts at 47cab4f' } : {}) };
};
const rebuildExperiment = new URLSearchParams(location.search).get('experiment') === 'rebuild';
const compactExperiment = rebuildExperiment || new URLSearchParams(location.search).get('experiment') === 'compact';
const ledgerKey = rebuildExperiment ? 'bubble-summary-rebuild-eval-2026-10-06' : compactExperiment ? 'bubble-summary-compact-eval-2026-10-05' : 'bubble-summary-eval-2026-10-05';
const savedLedger = localStorage.getItem(ledgerKey);
const records: any[] = JSON.parse(savedLedger?.startsWith('lz:') ? decompressFromUTF16(savedLedger.slice(3))! : savedLedger ?? '[]');
const persist = () => localStorage.setItem(ledgerKey, 'lz:' + compressToUTF16(JSON.stringify(records))); // Only this experiment's key; preserve app storage.
const $ = (id: string) => document.getElementById(id)!;
for (const option of Array.from(($('phase') as HTMLSelectElement).options)) if (rebuildExperiment ? !option.value.startsWith('rebuild-') : option.value.startsWith('rebuild-') || option.value.startsWith('compact-') !== compactExperiment) option.remove();
const cost = () => records.reduce((sum, r) => sum + (r.accounted_cost ?? 0), 0);
let controller: AbortController | undefined;
const base: ConfigInterface = { model: 'anthropic/claude-opus-4.6', providerId: 'openrouter', modelSource: 'remote', max_tokens: 2048, temperature: 1, top_p: 1, presence_penalty: 0, frequency_penalty: 0, reasoning_effort: 'none', force_reasoning: true, openRouter: { responseCache: { mode: 'off' } } };
const messagesFor = (value: any): MessageInterface[] => (Array.isArray(value) ? value : [value]).map(v => ({ role: v.role, content: [{ type: 'text', text: v.content }] }));
const update = () => {
  $('status').textContent = `${controller ? '実行中' : '待機'} · ${records.length}送信記録 · 計上費用 $${cost().toFixed(4)} / $10`;
  $('progress').textContent = records.slice(-6).map(r => `${r.phase} ${r.case_id} #${r.repeat + 1} ${r.config.model} ${r.finish_reason ?? r.error ?? ''}`).join('\n');
  $('records').textContent = JSON.stringify(records, null, 2);
};
async function call(phase: string, item: any, repeat: number, config: ConfigInterface, messages: MessageInterface[], extra: object = {}) {
  const key = store.getState().providers.openrouter?.apiKey;
  if (!key) throw new Error('メイン画面のOpenRouter設定にAPIキーを入力してください。');
  const free = config.model.endsWith(':free');
  if (compactExperiment && free) { await new Promise(resolve => setTimeout(resolve, 3500)); if (controller?.signal.aborted) throw new Error('停止しました。'); }
  // UTF-8 bytes conservatively bound input tokens; output includes any reasoning tokens.
  const inputBound = (extra as { input_token_bound?: number }).input_token_bound ?? new TextEncoder().encode(JSON.stringify(messages)).length;
  const ceiling = free ? 0 : inputBound * 0.00000625 + config.max_tokens * 0.000025;
  if (cost() + ceiling > 10) throw new Error('総費用上限に達する可能性があるため停止しました。');
  const started = new Date().toISOString();
  const effective = { ...config, openRouter: { routing: hardOpenRouterConstraints(config.openRouter), responseCache: { mode: 'off' as const } } };
  const entry: any = { phase, case_id: item.id, repeat, started, endpoint, config: effective, input: messages, accounted_cost: ceiling, pending: true, evaluation_version: evaluationVersion(phase), ...extra };
  records.push(entry); persist(); update();
  try {
    const data = await getChatCompletion(endpoint, messages, effective, key, undefined, undefined, controller?.signal, { auxiliary: true });
    const usage = data.usage;
    if (!usage || typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number') throw new Error(`APIが使用トークンを返さないため停止します（APIエラーコード: ${data.error?.code ?? 'なし'}）。`);
    const accounted = typeof usage.cost === 'number' ? usage.cost : free ? 0 : usage.prompt_tokens * 0.00000625 + usage.completion_tokens * 0.000025;
    const result = { phase, case_id: item.id, repeat, started, completed: new Date().toISOString(), endpoint, config: effective, input: messages, source: item.input, semantic_checks: item.semantic_checks, output: data.choices?.[0]?.message?.content ?? '', finish_reason: data.choices?.[0]?.finish_reason, model_returned: data.model, provider_returned: data.provider, response_id: data.id, usage, accounted_cost: accounted, judgment: '未判定：意味条件と後続応答をレビューする', ...extra };
    Object.assign(entry, result); delete entry.pending; return entry;
  } catch (error) {
    // Reserve the maximum for unknown failed/aborted requests; never assume they were free.
    Object.assign(entry, { error: String(error).replaceAll(key, '[redacted]').replace(/"user_id"\s*:\s*"[^"]*"/g, '"user_id":"[redacted]"') }); delete entry.pending;
    throw error;
  } finally { persist(); update(); }
}
const promptMessages = (item: any, baseline: boolean, prompt = buildBubbleSummaryPrompt) => [{ role: 'user', content: [{ type: 'text', text: (baseline ? baselinePrompt : prompt)(messagesFor(item.input)) }] }] as MessageInterface[];
function replacement(item: any, text: string, apply = applyBubbleSummariesForSubmit, format?: 'compact') {
  const messages = messagesFor(item.input);
  const chat = { id: 'experiment', title: item.id, titleSet: true, imageDetail: 'auto', config: base, messages, summaries: [{ id: 'summary', format, mode: messages.length === 1 ? 'single' : 'range', text, useForSubmit: true, sources: messages.map((m, i) => ({ nodeId: String(i), parentId: null, role: m.role, textParts: m.content.map((v: any) => v.text) })) }] } as ChatInterface;
  return apply(chat, messages.length);
}
async function parallel(jobs: (() => Promise<unknown>)[], concurrency = 2) {
  let next = 0;
  const results = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
    try { while (next < jobs.length && !controller?.signal.aborted) await jobs[next++](); }
    catch (error) { controller?.abort(); throw error; }
  }));
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) throw failure.reason;
}
$('run').onclick = async () => {
  const selectedPhase = ($('phase') as HTMLSelectElement).value;
  const phase = selectedPhase.startsWith('free') ? 'free' : selectedPhase;
  controller = new AbortController(); ($('run') as HTMLButtonElement).disabled = true; ($('stop') as HTMLButtonElement).disabled = false;
  const repeats = phase.endsWith('candidate5') || phase === 'main472' ? 2 : 3;
  const cases = corpus.cases.filter(c => c.split === (phase === 'holdout' ? 'holdout' : 'development') && (phase !== 'main472' || ['S09', 'S15', 'S16', 'C05', 'C13', 'C14'].includes(c.id)));
  const jobs: (() => Promise<unknown>)[] = [];
  try {
    if (rebuildExperiment) await loadEncoder();
    if (phase === 'rebuild-explicit-unknown') {
      if (!rebuildExperiment) throw new Error('新予算のURL experiment=rebuildを使用してください。');
      const item = rebuildRepair.cases.find(c => c.id === 'C02')!, config = { ...base, max_tokens: 128 };
      for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
        const extra = { evaluation_version: { directory: 'bubble-summary-rebuild-2026-10-06', candidate_prompt: 'candidate7-bubbleSummaryPrompt.ts', candidate_wrapper: 'candidate3-bubbleSummarySubmitMessage.ts', diagnostic_max_tokens: 128 } };
        const done = (condition: string) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.finish_reason === 'stop');
        const old = records.find(r => r.phase === 'rebuild-noexamples' && r.case_id === item.id && r.repeat === rep && r.condition === 'summary-candidate' && r.finish_reason === 'stop');
        if (!old) throw new Error('比較元の圧縮がありません。');
        const input = promptMessages(item, false, messages => rebuildExplicitUnknown(messages, 'compact'));
        const prefix = old.input[0].content[0].text, full = input[0].content[0];
        if (full.type !== 'text' || !full.text.startsWith(prefix)) throw new Error('既知の入力prefixと一致しません。');
        // Same known model/request prefix; reserve its observed input plus appended UTF-8 bytes and 256 tokens margin.
        const input_token_bound = old.usage.prompt_tokens + new TextEncoder().encode(full.text.slice(prefix.length)).length + 256;
        const candidate = done('summary-candidate') ?? await call(phase, item, rep, config, input, { ...extra, condition: 'summary-candidate', input_token_bound, reservation_basis: { prefix_response_id: old.response_id, prefix_input_tokens: old.usage.prompt_tokens, appended_utf8_bytes: new TextEncoder().encode(full.text.slice(prefix.length)).length, token_margin: 256 } });
        if (candidate.finish_reason !== 'stop') throw new Error('未完了の圧縮は使用できません。');
        for (const condition of ['follow-original', 'follow-old', 'follow-candidate']) {
          if (done(condition)) continue;
          const summary = condition === 'follow-old' ? old : candidate;
          const history = condition === 'follow-original' ? messagesFor(item.input) : [explicitStyleSubmitMessage({ id: 'eval', text: summary.output, format: 'compact', mode: 'single', useForSubmit: true, sources: [] })];
          await call(phase, item, rep, config, [...history, ...messagesFor({ role: 'user', content: '何の対象についての原因か、与えられている情報だけで一文で答えてください。' })], { ...extra, condition, probe: 0, summary_response_id: condition === 'follow-original' ? undefined : summary.response_id });
        }
      });
    } else if (phase === 'rebuild-grounding') {
      if (!rebuildExperiment) throw new Error('新予算のURL experiment=rebuildを使用してください。');
      for (const id of ['C02', 'R11']) for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
        if (records.some(r => r.phase === phase && r.case_id === id && r.repeat === rep && r.finish_reason === 'stop')) return;
        const item = id === 'C02' ? rebuildRepair.cases.find(c => c.id === id)! : rebuildLayoutHoldout.cases.find(c => c.id === id)!;
        const sourcePhase = id === 'C02' ? 'rebuild-noexamples' : 'rebuild-layout-holdout';
        const summary = records.find(r => r.phase === sourcePhase && r.case_id === id && r.repeat === rep && r.condition === 'summary-candidate' && r.finish_reason === 'stop');
        if (!summary) throw new Error('比較元の圧縮がありません。');
        const paired = records.find(r => r.phase === sourcePhase && r.case_id === id && r.repeat === rep && r.condition === 'follow-candidate' && r.probe === 0);
        const question = id === 'C02' ? '何の対象についての原因か、与えられている情報だけで一文で答えてください。' : item.followups[0];
        await call(phase, item, rep, { ...base, max_tokens: id === 'C02' ? 256 : 768 }, [groundedSubmitMessage({ id: 'eval', text: summary.output, format: 'compact', mode: 'single', useForSubmit: true, sources: [] }), ...messagesFor({ role: 'user', content: question })], { condition: 'follow-candidate4', probe: 0, summary_response_id: summary.response_id, paired_response_id: paired?.response_id, evaluation_version: { directory: 'bubble-summary-rebuild-2026-10-06', candidate_prompt: id === 'C02' ? 'candidate6-bubbleSummaryPrompt.ts' : 'candidate3-bubbleSummaryPrompt.ts', candidate_wrapper: 'candidate4-bubbleSummarySubmitMessage.ts', sourcePhase } });
      });
    } else if (phase === 'rebuild-noexamples') {
      if (!rebuildExperiment) throw new Error('新予算のURL experiment=rebuildを使用してください。');
      const item = rebuildRepair.cases.find(c => c.id === 'C02')!;
      // A separate, short diagnostic condition; do not pool with the max_tokens=2048 trials.
      const config = { ...base, max_tokens: 256 };
      for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
        const extra = { evaluation_version: { directory: 'bubble-summary-rebuild-2026-10-06', before_prompt: 'candidate5-bubbleSummaryPrompt.ts', candidate_prompt: 'candidate6-bubbleSummaryPrompt.ts', candidate_wrapper: 'candidate3-bubbleSummarySubmitMessage.ts', diagnostic_max_tokens: 256 } };
        const done = (condition: string) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.finish_reason === 'stop');
        const old = records.find(r => r.phase === 'rebuild-repair' && r.case_id === item.id && r.repeat === rep && r.condition === 'summary-candidate' && r.finish_reason === 'stop');
        if (!old) throw new Error('比較元の圧縮がありません。');
        const candidate = done('summary-candidate') ?? await call(phase, item, rep, config, promptMessages(item, false, messages => rebuildWithoutExamples(messages, 'compact')), { ...extra, condition: 'summary-candidate' });
        if (candidate.finish_reason !== 'stop') throw new Error('未完了の圧縮は使用できません。');
        for (const condition of ['follow-original', 'follow-old', 'follow-candidate']) {
          if (done(condition)) continue;
          const summary = condition === 'follow-old' ? old : candidate;
          const history = condition === 'follow-original' ? messagesFor(item.input) : [explicitStyleSubmitMessage({ id: 'eval', text: summary.output, format: 'compact', mode: 'single', useForSubmit: true, sources: [] })];
          await call(phase, item, rep, config, [...history, ...messagesFor({ role: 'user', content: '何の対象についての原因か、与えられている情報だけで一文で答えてください。' })], { ...extra, condition, probe: 0, summary_response_id: condition === 'follow-original' ? undefined : summary.response_id });
        }
      });
    } else if (phase === 'rebuild-repair') {
      if (!rebuildExperiment) throw new Error('新予算のURL experiment=rebuildを使用してください。');
      for (const item of rebuildRepair.cases) for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
        const extra = { evaluation_version: { directory: 'bubble-summary-rebuild-2026-10-06', before_prompt: 'candidate3-bubbleSummaryPrompt.ts', candidate_prompt: 'candidate5-bubbleSummaryPrompt.ts', candidate_wrapper: 'candidate3-bubbleSummarySubmitMessage.ts' } };
        const done = (condition: string) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.finish_reason === 'stop');
        const old = done('summary-old') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => rebuildBeforeRepair(messages, 'compact')), { ...extra, condition: 'summary-old' });
        const candidate = done('summary-candidate') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => rebuildCandidate5(messages, 'compact')), { ...extra, condition: 'summary-candidate' });
        if (old.finish_reason !== 'stop' || candidate.finish_reason !== 'stop') throw new Error('未完了の圧縮は使用できません。');
        for (const condition of ['follow-original', 'follow-old', 'follow-candidate']) {
          if (done(condition)) continue;
          const summary = condition === 'follow-old' ? old : candidate;
          const history = condition === 'follow-original' ? messagesFor(item.input) : [explicitStyleSubmitMessage({ id: 'eval', text: summary.output, format: 'compact', mode: 'single', useForSubmit: true, sources: [] })];
          await call(phase, item, rep, base, [...history, ...messagesFor({ role: 'user', content: item.followups[0] })], { ...extra, condition, probe: 0, summary_response_id: condition === 'follow-original' ? undefined : summary.response_id });
        }
      });
    } else if (phase === 'rebuild-layout') {
      if (!rebuildExperiment) throw new Error('新予算のURL experiment=rebuildを使用してください。');
      for (const item of [...rebuildFinalHoldout.cases, ...rebuildHoldout.cases.filter(c => ['R04', 'R06'].includes(c.id))]) for (let rep = 0; rep < 3; rep++) jobs.push(async () => {
        const extra = { condition: 'summary-candidate', evaluation_version: { directory: 'bubble-summary-rebuild-2026-10-06', candidate_prompt: 'candidate4-bubbleSummaryPrompt.ts', candidate_wrapper: 'candidate3-bubbleSummarySubmitMessage.ts' } };
        const summary = records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === 'summary-candidate' && r.finish_reason === 'stop') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => rebuildCandidate4(messages, 'compact')), extra);
        if (summary.finish_reason !== 'stop') throw new Error('未完了の圧縮は使用できません。');
        const original = messagesFor(item.input), compact = [explicitStyleSubmitMessage({ id: 'eval', text: summary.output, format: 'compact', mode: 'single', useForSubmit: true, sources: [] })];
        const [originalTokens, replacementTokens] = await Promise.all([countTokens(original, base.model), countTokens(compact, base.model)]);
        for (let probe = 0; probe < item.followups.length; probe++) {
          if (records.some(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.probe === probe && r.finish_reason === 'stop')) continue;
          const pairedPhase = item.id === 'R04' || item.id === 'R06' ? 'rebuild-wrapper' : 'rebuild-final-holdout';
          const paired = records.find(r => r.phase === pairedPhase && r.case_id === item.id && r.repeat === rep && r.probe === probe && (r.condition === 'follow-candidate' || r.condition === 'follow-candidate3'));
          await call(phase, item, rep, base, [...compact, ...messagesFor({ role: 'user', content: item.followups[probe] })], { ...extra, condition: 'follow-candidate', probe, originalTokens, replacementTokens, candidate_automatic_selection: replacementTokens < originalTokens ? 'compact' : 'original', forced_diagnostic: replacementTokens >= originalTokens, summary_response_id: summary.response_id, paired_response_id: paired?.response_id });
        }
      });
    } else if (phase === 'rebuild-wrapper') {
      if (!rebuildExperiment) throw new Error('新予算のURL experiment=rebuildを使用してください。');
      for (const item of [...rebuildDevelopment.cases, ...rebuildHoldout.cases]) for (let rep = 0; rep < 3; rep++) jobs.push(async () => {
        const sourcePhase = item.id.startsWith('R') ? 'rebuild-holdout' : 'rebuild-development-v2';
        const summary = records.find(r => r.phase === sourcePhase && r.case_id === item.id && r.repeat === rep && r.condition === 'summary-candidate' && r.finish_reason === 'stop');
        if (!summary) throw new Error(`${item.id}: 比較元の圧縮がありません。`);
        for (let probe = 0; probe < item.followups.length; probe++) {
          if (records.some(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.probe === probe && r.finish_reason === 'stop')) continue;
          const paired = records.find(r => r.phase === sourcePhase && r.case_id === item.id && r.repeat === rep && r.probe === probe && r.condition === 'follow-candidate');
          await call(phase, item, rep, base, [explicitStyleSubmitMessage({ id: 'eval', text: summary.output, format: 'compact', mode: 'single', useForSubmit: true, sources: [] }), ...messagesFor({ role: 'user', content: item.followups[probe] })], { condition: 'follow-candidate3', probe, summary_response_id: summary.response_id, paired_response_id: paired?.response_id, candidate_automatic_selection: paired?.candidate_automatic_selection, forced_diagnostic: paired?.forced_diagnostic, evaluation_version: { directory: 'bubble-summary-rebuild-2026-10-06', candidate_prompt: 'candidate2-bubbleSummaryPrompt.ts', candidate_wrapper: 'candidate3-bubbleSummarySubmitMessage.ts', sourcePhase } });
        }
      });
    } else if (['rebuild-development', 'rebuild-development-v2', 'rebuild-holdout', 'rebuild-final-holdout', 'rebuild-layout-holdout', 'rebuild-regression'].includes(phase)) {
      if (!rebuildExperiment) throw new Error('新予算のURL experiment=rebuildを使用してください。');
      const selected = phase.endsWith('regression') ? corpus.cases : phase === 'rebuild-layout-holdout' ? rebuildLayoutHoldout.cases : phase === 'rebuild-final-holdout' ? rebuildFinalHoldout.cases : phase.endsWith('holdout') ? rebuildHoldout.cases : rebuildDevelopment.cases;
      const candidatePrompt = phase === 'rebuild-development' ? rebuildCandidate1 : ['rebuild-development-v2', 'rebuild-holdout'].includes(phase) ? rebuildCandidate2 : rebuildBeforeRepair;
      for (const item of selected) for (let rep = 0; rep < (phase.endsWith('regression') ? 2 : 3); rep++) jobs.push(async () => {
        const done = (condition: string, probe?: number) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.probe === probe && r.finish_reason === 'stop' && r.usage);
        const extra = { style_checks: 'style_checks' in item ? item.style_checks : undefined, split: item.split, evaluation_version: { base_commit: 'd064543', directory: 'bubble-summary-rebuild-2026-10-06', baseline_prompt: 'baseline-bubbleSummaryPrompt.ts', candidate_prompt: phase === 'rebuild-development' ? 'candidate1-bubbleSummaryPrompt.ts' : ['rebuild-development-v2', 'rebuild-holdout'].includes(phase) ? 'candidate2-bubbleSummaryPrompt.ts' : 'candidate3-bubbleSummaryPrompt.ts', candidate_wrapper: phase.endsWith('holdout') && phase !== 'rebuild-holdout' ? 'candidate3-bubbleSummarySubmitMessage.ts' : 'candidate-bubbleSummarySubmitMessage.ts' } };
        const baseline = done('summary-baseline') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => downstreamBaseline(messages, 'compact')), { ...extra, condition: 'summary-baseline' });
        const candidate = done('summary-candidate') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => candidatePrompt(messages, 'compact')), { ...extra, condition: 'summary-candidate' });
        if (baseline.finish_reason !== 'stop' || candidate.finish_reason !== 'stop') throw new Error('未完了の圧縮は使用できません。');
        if (phase.endsWith('regression')) return;
        const original = messagesFor(item.input);
        const compact = [(phase.endsWith('holdout') && phase !== 'rebuild-holdout' ? explicitStyleSubmitMessage : rebuildSubmitMessage)({ id: 'eval', text: candidate.output, format: 'compact', mode: 'single', useForSubmit: true, sources: [] })];
        const [originalTokens, replacementTokens] = await Promise.all([countTokens(original, base.model), countTokens(compact, base.model)]);
        const probes = 'followups' in item ? item.followups : [];
        for (let probe = 0; probe < probes.length; probe++) for (const condition of ['follow-original', 'follow-baseline', 'follow-candidate']) {
          if (done(condition, probe)) continue;
          const history = condition === 'follow-original' ? original : condition === 'follow-baseline' ? replacement(item, baseline.output, applyBubbleSummariesForSubmit, 'compact') : compact;
          await call(phase, item, rep, base, [...history, ...messagesFor({ role: 'user', content: probes[probe] })], { ...extra, condition, probe, originalTokens, replacementTokens, candidate_automatic_selection: replacementTokens < originalTokens ? 'compact' : 'original', forced_diagnostic: condition === 'follow-candidate' && replacementTokens >= originalTokens, summary_response_id: condition === 'follow-original' ? undefined : condition === 'follow-baseline' ? baseline.response_id : candidate.response_id });
        }
      });
    } else if (phase === 'rebuild-ablation') {
      if (!rebuildExperiment) throw new Error('新予算のURL experiment=rebuildを使用してください。');
      for (const item of rebuildCorpus.cases) for (let rep = 0; rep < 3; rep++) jobs.push(async () => {
        const done = (condition: string, probe?: number) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.probe === probe && r.finish_reason === 'stop' && r.usage);
        const extra = { style_checks: item.style_checks, evaluation_version: { base_commit: 'd064543', directory: 'bubble-summary-rebuild-2026-10-06', experiment: 'prompt and wrapper factorial comparison, forced diagnostic replacement' } };
        const summaries = [];
        for (let p = 0; p < 2; p++) summaries[p] = done(`summary-P${p}`) ?? await call(phase, item, rep, base, promptMessages(item, false, messages => (p ? downstreamCandidate3 : downstreamBaseline)(messages, 'compact')), { ...extra, condition: `summary-P${p}`, prompt_snapshot: p ? 'candidate3-bubbleSummaryPrompt.ts from previous evaluation' : 'baseline-bubbleSummaryPrompt.ts' });
        if (summaries.some(r => r.finish_reason !== 'stop')) throw new Error('未完了の圧縮は使用できません。');
        const conditions = ['original', 'P0W0', 'P1W0', 'P0W1', 'P1W1'];
        for (let probe = 0; probe < item.followups.length; probe++) for (const condition of [...conditions.slice(rep), ...conditions.slice(0, rep)]) {
          if (done(condition, probe)) continue;
          const summary = summaries[condition[1] === '1' ? 1 : 0];
          const history = condition === 'original' ? messagesFor(item.input) : condition.endsWith('W0') ? replacement(item, summary.output, applyBubbleSummariesForSubmit, 'compact') : [candidateSubmitMessage({ id: 'eval', text: summary.output, format: 'compact', mode: 'single', useForSubmit: true, sources: [] })];
          await call(phase, item, rep, base, [...history, ...messagesFor({ role: 'user', content: item.followups[probe] })], { ...extra, condition, probe, summary_response_id: condition === 'original' ? undefined : summary.response_id });
        }
      });
    } else if (phase === 'compact-v3-development') {
      if (!compactExperiment) throw new Error('独立予算のURL experiment=compact を使用してください。');
      for (const item of compactCorpus.cases.filter(c => c.split === 'development')) for (let rep = 0; rep < 2; rep++) {
        const summary = records.find(r => r.phase === 'compact-v2-development' && r.case_id === item.id && r.repeat === rep && r.condition === 'summary-compact' && r.finish_reason === 'stop');
        if (!summary) throw new Error(`${item.id}: v2要約がありません。`);
        if (records.some(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.usage)) continue;
        jobs.push(() => call(phase, item, rep, base, [...replacement(item, summary.output, applyBubbleSummariesForSubmit, 'compact'), ...messagesFor({ role: 'user', content: item.followup })], { condition: 'follow-compact', summary_response_id: summary.response_id, style_checks: item.style_checks, evaluation_version: { prompt_snapshot: 'compact-v2-bubbleSummaryPrompt.ts', base_commit: '625263c43335d104f5e7dc2c0eeb5947d783723b', history_replacement: 'compact-v3-bubbleSummary.ts' } }));
      }
    } else if (phase === 'compact-v5-probes') {
      for (const item of [...corpus.cases.filter(c => ['C05', 'C13'].includes(c.id)), ...compactCorpus.cases.filter(c => ['T03', 'T05', 'T06', 'T10', 'T11'].includes(c.id))]) for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
        const done = (condition: string) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.usage);
        const extra = { style_checks: 'style_checks' in item ? item.style_checks : undefined, evaluation_version: { prompt_snapshot: 'compact-v5-bubbleSummaryPrompt.ts', base_commit: '625263c43335d104f5e7dc2c0eeb5947d783723b', history_replacement: 'compact-v3-bubbleSummary.ts' } };
        const summary = done('summary-compact') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => compactV5(messages, 'compact')), { ...extra, condition: 'summary-compact' });
        if (summary.finish_reason !== 'stop') return;
        if (!done('follow-compact')) await call(phase, item, rep, base, [...replacement(item, summary.output, applyBubbleSummariesForSubmit, 'compact'), ...messagesFor({ role: 'user', content: item.followup })], { ...extra, condition: 'follow-compact', summary_response_id: summary.response_id });
      });
    } else if (phase === 'compact-regression') {
      if (!compactExperiment) throw new Error('独立予算のURL experiment=compact を使用してください。');
      for (const item of corpus.cases) for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
        const done = (condition: string) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.usage);
        const extra = { evaluation_version: { prompt_snapshot: 'compact-v2-bubbleSummaryPrompt.ts', base_commit: '625263c43335d104f5e7dc2c0eeb5947d783723b', history_replacement: 'compact-v3-bubbleSummary.ts' } };
        const result = done('summary-compact') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => compactV2(messages, 'compact')), { ...extra, condition: 'summary-compact' });
        if (!['S09', 'S15', 'S16', 'C05', 'C13', 'C14'].includes(item.id) || result.finish_reason !== 'stop' || !result.output) return;
        for (const condition of ['follow-original', 'follow-compact']) {
          if (done(condition)) continue;
          await call(phase, item, rep, base, [...(condition === 'follow-original' ? messagesFor(item.input) : replacement(item, result.output, applyBubbleSummariesForSubmit, 'compact')), ...messagesFor({ role: 'user', content: item.followup })], { ...extra, condition, summary_response_id: condition === 'follow-compact' ? result.response_id : undefined });
        }
      });
    } else if (phase === 'compact-free') {
      if (!compactExperiment) throw new Error('独立予算のURL experiment=compact を使用してください。');
      const liveModels = (await (await fetch('https://openrouter.ai/api/v1/models')).json()).data;
      for (const model of ['qwen/qwen3.8-27b:free', 'nvidia/nemotron-3-ultra-550b-a55b:free']) {
        const meta = liveModels.find((m: any) => m.id === model);
        if (!meta || Number(meta.pricing.prompt) !== 0 || Number(meta.pricing.completion) !== 0) throw new Error(`${model}: 無料提供を確認できません。`);
        for (const params of [{ temperature: 0.2, reasoning_effort: 'none' }, { temperature: 1, reasoning_effort: 'none' }, { temperature: 1, reasoning_effort: 'low' }]) for (const item of compactCorpus.cases.filter(c => ['T05', 'T10'].includes(c.id))) for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
          const config = { ...base, model, ...params } as ConfigInterface;
          const done = (condition: string) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.config.model === model && r.config.temperature === params.temperature && r.config.reasoning_effort === params.reasoning_effort && r.usage);
          const extra = { style_checks: item.style_checks, model_metadata: { id: meta.id, pricing: meta.pricing, supported_parameters: meta.supported_parameters }, evaluation_version: { prompt_snapshot: 'compact-v2-bubbleSummaryPrompt.ts', base_commit: '625263c43335d104f5e7dc2c0eeb5947d783723b', history_replacement: 'compact-v3-bubbleSummary.ts' } };
          const result = done('summary-compact') ?? await call(phase, item, rep, config, promptMessages(item, false, messages => compactV2(messages, 'compact')), { ...extra, condition: 'summary-compact' });
          if (result.finish_reason !== 'stop' || !result.output) return;
          for (const condition of ['follow-original', 'follow-compact']) {
            if (done(condition)) continue;
            await call(phase, item, rep, config, [...(condition === 'follow-original' ? messagesFor(item.input) : replacement(item, result.output, applyBubbleSummariesForSubmit, 'compact')), ...messagesFor({ role: 'user', content: item.followup })], { ...extra, condition, summary_response_id: condition === 'follow-compact' ? result.response_id : undefined });
          }
        });
      }
    } else if (phase === 'compact-downstream-v4' || phase === 'compact-downstream-v5') {
      if (!compactExperiment) throw new Error('既存の圧縮検証台帳 experiment=compact を使用してください。');
      for (const item of downstreamCorpus4.cases) for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
        const done = (condition: string) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.finish_reason === 'stop' && r.usage);
        const prior = (condition: string) => records.find(r => ['compact-downstream', 'compact-extreme'].includes(r.phase) && r.case_id === item.id && r.repeat === rep && r.condition === condition && (r.probe === undefined || r.probe === 0) && r.finish_reason === 'stop' && r.usage);
        const extra = { style_checks: item.style_checks, split: item.split, evaluation_version: { baseline_snapshot: 'baseline-bubbleSummaryPrompt.ts', prompt_snapshot: phase.endsWith('v5') ? 'candidate5-bubbleSummaryPrompt.ts' : 'candidate4-bubbleSummaryPrompt.ts', directory: 'bubble-summary-downstream-2026-10-06', base_commit: '016b70d', history_replacement: 'src/utils/bubbleSummary.ts at 016b70d', automatic_selection: 'replacementTokens < originalTokens, same as startBubbleSummary' } };
        const candidate = done('summary-candidate') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => (phase.endsWith('v5') ? downstreamCandidate5 : downstreamCandidate4)(messages, 'compact')), { ...extra, condition: 'summary-candidate' });
        if (candidate.finish_reason !== 'stop') throw new Error('未完了の圧縮を後続応答へ渡せません。');
        const original = messagesFor(item.input), compact = replacement(item, candidate.output, applyBubbleSummariesForSubmit, 'compact');
        const [originalTokens, replacementTokens] = await Promise.all([countTokens(original, base.model), countTokens(compact, base.model)]);
        if (!done('follow-original') && !prior('follow-original')) await call(phase, item, rep, base, [...original, ...messagesFor({ role: 'user', content: item.followups[0] })], { ...extra, condition: 'follow-original' });
        if (!done('follow-effective')) await call(phase, item, rep, base, [...(replacementTokens < originalTokens ? compact : original), ...messagesFor({ role: 'user', content: item.followups[0] })], { ...extra, condition: 'follow-effective', probe: 0, summary_response_id: candidate.response_id, originalTokens, replacementTokens, effective_history: replacementTokens < originalTokens ? 'compact' : 'original', comparator_response_id: prior('follow-original')?.response_id });
      });
    } else if (phase === 'compact-downstream-v3' || phase === 'compact-downstream-free') {
      if (!compactExperiment) throw new Error('既存の圧縮検証台帳 experiment=compact を使用してください。');
      const free = phase.endsWith('-free');
      const meta = free ? (await (await fetch('https://openrouter.ai/api/v1/models')).json()).data.find((m: any) => m.id === 'google/gemma-4-31b-it:free') : undefined;
      if (free && (!meta || Number(meta.pricing.prompt) !== 0 || Number(meta.pricing.completion) !== 0)) throw new Error('無料提供を確認できません。');
      const configs = free ? [0.2, 1].map(temperature => ({ ...base, model: meta.id, temperature })) : [base];
      const cases = free ? downstreamCorpus3.cases.filter(c => c.id === 'T10') : downstreamCorpus3.cases;
      for (const config of configs) for (const item of cases) for (let rep = 0; rep < (free ? 2 : 3); rep++) jobs.push(async () => {
        const done = (condition: string, probe?: number) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.probe === probe && r.config.model === config.model && r.config.temperature === config.temperature && r.finish_reason === 'stop' && r.usage);
        const prior = (condition: string, probe?: number) => free || !['summary-baseline', 'follow-original', 'follow-baseline'].includes(condition) ? undefined : records.find(r => ['compact-downstream-v2', 'compact-downstream'].includes(r.phase) && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.probe === probe && r.finish_reason === 'stop' && r.usage);
        const extra = { style_checks: item.style_checks, split: item.split, model_metadata: meta && { id: meta.id, pricing: meta.pricing, supported_parameters: meta.supported_parameters }, evaluation_version: { baseline_snapshot: 'baseline-bubbleSummaryPrompt.ts', prompt_snapshot: free ? 'candidate5-bubbleSummaryPrompt.ts' : 'candidate3-bubbleSummaryPrompt.ts', directory: 'bubble-summary-downstream-2026-10-06', base_commit: '016b70d', history_replacement: free ? 'src/utils/bubbleSummary.ts at 016b70d, forced diagnostic replacement' : 'candidate-bubbleSummarySubmitMessage.ts' } };
        const baseline = prior('summary-baseline') ?? done('summary-baseline') ?? await call(phase, item, rep, config, promptMessages(item, false, messages => downstreamBaseline(messages, 'compact')), { ...extra, condition: 'summary-baseline' });
        const candidate = done('summary-candidate') ?? await call(phase, item, rep, config, promptMessages(item, false, messages => (free ? downstreamCandidate5 : downstreamCandidate3)(messages, 'compact')), { ...extra, condition: 'summary-candidate' });
        if (baseline.finish_reason !== 'stop' || candidate.finish_reason !== 'stop') throw new Error('未完了の圧縮を後続応答へ渡せません。');
        for (let probe = 0; probe < (free ? 1 : item.followups.length); probe++) for (const condition of ['follow-original', 'follow-baseline', 'follow-candidate']) if (!done(condition, probe) && !prior(condition, probe)) {
          const source = condition === 'follow-baseline' ? baseline : candidate;
          const history = condition === 'follow-original' ? messagesFor(item.input) : condition === 'follow-baseline' || free ? replacement(item, source.output, applyBubbleSummariesForSubmit, 'compact') : [candidateSubmitMessage({ id: 'eval', text: source.output, format: 'compact', mode: 'single', useForSubmit: true, sources: [] })];
          await call(phase, item, rep, config, [...history, ...messagesFor({ role: 'user', content: item.followups[probe] })], { ...extra, condition, probe, summary_response_id: condition === 'follow-original' ? undefined : source.response_id, comparator_response_ids: ['follow-original', 'follow-baseline'].map(c => prior(c, probe)?.response_id).filter(Boolean) });
        }
      });
    } else if (phase === 'compact-downstream' || phase === 'compact-downstream-v2') {
      if (!compactExperiment) throw new Error('既存の圧縮検証台帳 experiment=compact を使用してください。');
      for (const item of (phase.endsWith('-v2') ? downstreamCorpus2 : downstreamCorpus).cases) for (let rep = 0; rep < 3; rep++) jobs.push(async () => {
        const done = (condition: string, probe?: number) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.probe === probe && r.finish_reason === 'stop' && r.usage);
        const extra = { style_checks: item.style_checks, split: item.split, evaluation_version: { baseline_snapshot: 'baseline-bubbleSummaryPrompt.ts', prompt_snapshot: phase.endsWith('-v2') ? 'candidate2-bubbleSummaryPrompt.ts' : 'candidate-bubbleSummaryPrompt.ts', directory: 'bubble-summary-downstream-2026-10-06', base_commit: '016b70d', history_replacement: 'src/utils/bubbleSummary.ts at 016b70d' } };
        const baseline = done('summary-baseline') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => downstreamBaseline(messages, 'compact')), { ...extra, condition: 'summary-baseline' });
        const candidate = done('summary-candidate') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => (phase.endsWith('-v2') ? downstreamCandidate2 : downstreamCandidate)(messages, 'compact')), { ...extra, condition: 'summary-candidate' });
        if (baseline.finish_reason !== 'stop' || candidate.finish_reason !== 'stop') throw new Error('未完了の圧縮を後続応答へ渡せません。');
        for (let probe = 0; probe < item.followups.length; probe++) for (const condition of ['follow-original', 'follow-baseline', 'follow-candidate']) if (!done(condition, probe)) {
          const source = condition === 'follow-baseline' ? baseline : candidate;
          await call(phase, item, rep, base, [...(condition === 'follow-original' ? messagesFor(item.input) : replacement(item, source.output, applyBubbleSummariesForSubmit, 'compact')), ...messagesFor({ role: 'user', content: item.followups[probe] })], { ...extra, condition, probe, summary_response_id: condition === 'follow-original' ? undefined : source.response_id });
        }
      });
    } else if (phase === 'compact-extreme') {
      if (!compactExperiment) throw new Error('既存の圧縮検証台帳 experiment=compact を使用してください。');
      const unseen = [
        { id: 'E01', input: { role: 'user', content: '創作の編集者として答えてください。舞台は月面の架空都市です。空気がないという現実性の指摘は不要。地の文は淡々と常体、人物の台詞は「戻れるとは、まだ言ってない」に込めた留保を維持。提案は二つまで。今の返答だけ100字以内、見出しなし。' }, followup: '帰還を巡る次の場面の案を出して。', style_checks: { max_100_characters: true, no_heading: true } },
        { id: 'E02', input: { role: 'user', content: ('更新案Aは待機30秒、Bは待機45秒という例です。初期値は5秒、許容範囲は5〜60秒。まだ計測していません。説明には案Aと案Bの両方を比較してください。'.repeat(8)) + '補足：採用はAです。Bは未採用。計測済みとは書かないでください。今回だけ2文、です・ます調で答えてください。' }, followup: '採用した設定と次に必要な作業を教えて。', style_checks: { two_sentences: true, polite: true } },
      ];
      const selected = [...compactCorpus.cases.filter(c => ['T01', 'T05', 'T06', 'T10', 'T13', 'T14'].includes(c.id)), ...unseen];
      for (const item of selected) for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
        const done = (condition: string) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.usage);
        const extra = { style_checks: item.style_checks, evaluation_version: { prompt_snapshot: 'candidate-bubbleSummaryPrompt.ts', base_commit: 'b52f3ad', history_replacement: 'src/utils/bubbleSummary.ts' } };
        const baseline = done('summary-baseline') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => buildBubbleSummaryPrompt(messages, 'compact')), { ...extra, condition: 'summary-baseline' });
        const candidate = done('summary-extreme') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => extremePrompt(messages, 'compact')), { ...extra, condition: 'summary-extreme' });
        if (baseline.finish_reason !== 'stop' || candidate.finish_reason !== 'stop') return;
        for (const condition of ['follow-original', 'follow-baseline', 'follow-extreme']) if (!done(condition)) {
          const source = condition === 'follow-baseline' ? baseline : candidate;
          await call(phase, item, rep, base, [...(condition === 'follow-original' ? messagesFor(item.input) : replacement(item, source.output, applyBubbleSummariesForSubmit, 'compact')), ...messagesFor({ role: 'user', content: item.followup })], { ...extra, condition, summary_response_id: condition === 'follow-original' ? undefined : source.response_id });
        }
      });
    } else if (phase === 'compact-v5-validation') {
      for (const item of compactCorpus.cases.filter(c => c.split === 'validation')) for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
        const done = (condition: string) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.usage);
        const extra = { style_checks: item.style_checks, evaluation_version: { prompt_snapshot: 'compact-v5-bubbleSummaryPrompt.ts', base_commit: '625263c43335d104f5e7dc2c0eeb5947d783723b', history_replacement: 'compact-v3-bubbleSummary.ts' } };
        const summary = done('summary-compact') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => compactV5(messages, 'compact')), { ...extra, condition: 'summary-compact' });
        if (summary.finish_reason !== 'stop') return;
        for (const condition of ['follow-original', 'follow-compact']) if (!done(condition)) await call(phase, item, rep, base, [...(condition === 'follow-original' ? messagesFor(item.input) : replacement(item, summary.output, applyBubbleSummariesForSubmit, 'compact')), ...messagesFor({ role: 'user', content: item.followup })], { ...extra, condition, summary_response_id: condition === 'follow-compact' ? summary.response_id : undefined });
      });
    } else if (phase.startsWith('compact-')) {
      if (!compactExperiment) throw new Error('独立予算のURL experiment=compact を使用してください。');
      for (const item of compactCorpus.cases.filter(c => c.split === (phase.includes('holdout') ? 'holdout' : phase.endsWith('audit') ? 'audit' : 'development'))) for (let rep = 0; rep < 2; rep++) jobs.push(async () => {
        const done = (condition: string) => records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.usage);
        const v2 = phase.includes('v2') || phase.includes('v3') || phase.includes('v4');
        const final = phase.includes('v4');
        const extra = { style_checks: item.style_checks, evaluation_version: { prompt_snapshot: final ? 'compact-v3-bubbleSummaryPrompt.ts' : v2 ? 'compact-v2-bubbleSummaryPrompt.ts' : 'compact-v1-bubbleSummaryPrompt.ts', base_commit: '625263c43335d104f5e7dc2c0eeb5947d783723b', history_replacement: (phase.includes('v3') || final) ? 'compact-v3-bubbleSummary.ts' : 'compact-v2-bubbleSummary.ts' } };
        const baselineDone = (condition: string) => records.find(r => r.phase === 'compact-development' && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.usage);
        const readable = done('summary-readable') ?? (v2 ? baselineDone('summary-readable') : undefined) ?? await call(phase, item, rep, base, promptMessages(item, false, compactV1), { ...extra, condition: 'summary-readable' });
        const compact = done('summary-compact') ?? await call(phase, item, rep, base, promptMessages(item, false, messages => (final ? compactV3 : v2 ? compactV2 : compactV1)(messages, 'compact')), { ...extra, condition: 'summary-compact' });
        if ([readable, compact].some(r => r.finish_reason !== 'stop' || !r.output)) throw new Error('未完了の要約を後続応答へ渡せません。');
        for (const condition of ['follow-original', 'follow-readable', 'follow-compact']) {
          if (done(condition) || (v2 && condition !== 'follow-compact' && baselineDone(condition))) continue;
          const summary = condition === 'follow-readable' ? readable : compact;
          await call(phase, item, rep, base, [...messagesFor(item.surrounding_system ? { role: 'system', content: item.surrounding_system } : []), ...(condition === 'follow-original' ? messagesFor(item.input) : replacement(item, summary.output, (phase.includes('v3') || final) ? applyBubbleSummariesForSubmit : compactV2Replacement, condition === 'follow-compact' ? 'compact' : undefined)), ...messagesFor({ role: 'user', content: item.followup })], { ...extra, condition, summary_response_id: condition === 'follow-original' ? undefined : summary.response_id });
        }
      });
    } else if (phase.startsWith('downstream')) {
      const sourcePhase = phase.replace('downstream-', '');
      const probes = ['S08', 'S09', 'S15', 'S16', 'C05', 'C09', 'C13', 'C14', 'C15', 'C16'];
      for (const item of cases.filter(c => probes.includes(c.id))) for (let rep = 0; rep < repeats; rep++) {
        const summary = records.find(r => r.phase === sourcePhase && r.case_id === item.id && r.repeat === rep && r.output && r.finish_reason === 'stop');
        if (!summary) throw new Error(`${item.id} #${rep + 1}: 完了した要約がありません。`);
        const followup = messagesFor({ role: 'user', content: item.followup });
        for (const condition of ['original', 'summary']) {
          if (records.some(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.condition === condition && r.output)) continue;
          jobs.push(() => call(phase, item, rep, base, [...(condition === 'original' ? messagesFor(item.input) : replacement(item, summary.output, legacyReplacement)), ...followup], { condition, summary_response_id: summary.response_id }));
        }
      }
    } else if (phase === 'free') {
      const freeModels = ['qwen/qwen3.8-27b:free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-ultra-550b-a55b:free'].filter(model => selectedPhase === 'free' || model.startsWith(selectedPhase === 'free-gemma' ? 'google/' : selectedPhase === 'free-nemotron' ? 'nvidia/' : 'qwen/'));
      const liveModels = (await (await fetch('https://openrouter.ai/api/v1/models')).json()).data;
      for (const model of freeModels) {
        const meta = liveModels.find((m: any) => m.id === model);
        if (!meta || Number(meta.pricing.prompt) !== 0 || Number(meta.pricing.completion) !== 0) throw new Error(`${model}: 現在の無料提供を確認できません。`);
        const settings = [{ temperature: 0.2, reasoning_effort: 'none' }, { temperature: 1, reasoning_effort: 'none' }, ...((model.startsWith('qwen/') || model.startsWith('nvidia/')) ? [{ temperature: 1, reasoning_effort: 'low' }] : [])];
        for (const params of settings) for (const item of cases.filter(c => ['S06', 'S15', 'C13', 'C15'].includes(c.id))) for (let rep = 0; rep < 2; rep++) {
          const previous = records.find(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.config.model === model && r.config.temperature === params.temperature && r.config.reasoning_effort === params.reasoning_effort && r.usage);
          if (previous && (item.id !== 'C13' || previous.finish_reason !== 'stop' || ['original', 'summary'].every(condition => records.some(r => r.phase === 'downstream-free' && r.summary_response_id === previous.response_id && r.condition === condition && r.usage)))) continue;
          jobs.push(async () => {
            const config = { ...base, model, ...params } as ConfigInterface;
            await new Promise(resolve => setTimeout(resolve, 3000));
            const result = previous ?? await call(phase, item, rep, config, promptMessages(item, false, trial5Prompt), { model_metadata: { id: meta.id, name: meta.name, pricing: meta.pricing, supported_parameters: meta.supported_parameters, top_provider: meta.top_provider } });
            if (item.id === 'C13' && result.finish_reason === 'stop' && result.output) {
              for (const condition of ['original', 'summary']) {
                if (records.some(r => r.phase === 'downstream-free' && r.summary_response_id === result.response_id && r.condition === condition && r.usage)) continue;
                await call('downstream-free', item, rep, config, [...(condition === 'original' ? messagesFor(item.input) : replacement(item, result.output, legacyReplacement)), ...messagesFor({ role: 'user', content: item.followup })], { condition, summary_response_id: result.response_id });
              }
            }
          });
        }
      }
    } else {
      for (const item of cases) for (let rep = 0; rep < repeats; rep++) {
        if (records.some(r => r.phase === phase && r.case_id === item.id && r.repeat === rep && r.output)) continue;
        jobs.push(async () => {
          const result = await call(phase, item, rep, base, promptMessages(item, phase === 'baseline', phasePrompts[phase] ?? buildBubbleSummaryPrompt));
          if ((phase === 'holdout' || phase === 'main472') && result.finish_reason === 'stop') {
            const followup = messagesFor({ role: 'user', content: item.followup });
            for (const condition of ['original', 'summary']) await call(phase === 'main472' ? 'downstream-main472' : 'downstream-holdout', item, rep, base, [...(condition === 'original' ? messagesFor(item.input) : replacement(item, result.output, phase === 'main472' ? applyBubbleSummariesForSubmit : legacyReplacement)), ...followup], { condition, summary_response_id: result.response_id });
          }
        });
      }
    }
    await parallel(jobs.map(job => phase === 'compact-free' ? async () => { try { await job(); } catch (error) { if (!String(error).includes('\"code\":429')) throw error; } } : job), phase === 'free' || phase === 'compact-free' || phase === 'rebuild-repair' || phase === 'rebuild-noexamples' || phase === 'rebuild-grounding' || phase === 'rebuild-explicit-unknown' ? 1 : 2);
  } catch (error) { controller.abort(); $('progress').textContent += '\n' + String(error).replace(/"user_id"\s*:\s*"[^"]*"/g, '"user_id":"[redacted]"'); }
  finally { controller = undefined; ($('run') as HTMLButtonElement).disabled = false; ($('stop') as HTMLButtonElement).disabled = true; $('status').textContent = `終了 · ${records.length}送信記録 · 計上費用 $${cost().toFixed(4)} / $10`; }
};
$('stop').onclick = () => controller?.abort();
$('download').onclick = () => {
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: 1, cost_cap_usd: 10, records }, null, 2)], { type: 'application/json' }));
  link.href = url; link.download = compactExperiment ? 'bubble-summary-compact-api-results.json' : 'bubble-summary-api-results.json'; link.click(); URL.revokeObjectURL(url);
};
update();
