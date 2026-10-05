// Manual, dev-server-only experiment. Never include real chat content or credentials in records.
import store from '../../src/store/store';
import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import { getChatCompletion } from '../../src/api/api';
import { buildBubbleSummaryPrompt } from '../../src/utils/bubbleSummaryPrompt';
import { buildBubbleSummaryPrompt as baselinePrompt } from '../../docs/development/evaluations/bubble-summary-2026-10-05/baseline-bubbleSummaryPrompt';
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
import type { ChatInterface, ConfigInterface, MessageInterface } from '../../src/types/chat';

const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
const evaluationVersion = (phase: string) => {
  const source = phase.replace('downstream-', '');
  const prompt = source === 'baseline' ? 'baseline' : source === 'candidate' ? 'candidate1' : source === 'free' || source === 'holdout' ? 'candidate5' : source;
  return { prompt_snapshot: `${prompt}-bubbleSummaryPrompt.ts`, base_commit: source === 'main472' ? '81f86947a8ced3fc731931f79ce380ade5c83b16' : '47cab4f9e18be1bdbcabf62904bc4c1f20e6384b', ...(phase.startsWith('downstream') ? { history_replacement: source === 'main472' ? 'src/utils/bubbleSummary.ts at 81f8694' : 'baseline-bubbleSummary.ts at 47cab4f' } : {}) };
};
const ledgerKey = 'bubble-summary-eval-2026-10-05';
const savedLedger = localStorage.getItem(ledgerKey);
const records: any[] = JSON.parse(savedLedger?.startsWith('lz:') ? decompressFromUTF16(savedLedger.slice(3))! : savedLedger ?? '[]');
const persist = () => localStorage.setItem(ledgerKey, 'lz:' + compressToUTF16(JSON.stringify(records))); // Only this experiment's key; preserve app storage.
const $ = (id: string) => document.getElementById(id)!;
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
  // UTF-8 bytes conservatively bound input tokens; output includes any reasoning tokens.
  const ceiling = free ? 0 : new TextEncoder().encode(JSON.stringify(messages)).length * 0.00000625 + config.max_tokens * 0.000025;
  if (cost() + ceiling > 10) throw new Error('総費用上限に達する可能性があるため停止しました。');
  const started = new Date().toISOString();
  const effective = { ...config, openRouter: { routing: hardOpenRouterConstraints(config.openRouter), responseCache: { mode: 'off' as const } } };
  const entry: any = { phase, case_id: item.id, repeat, started, endpoint, config: effective, input: messages, accounted_cost: ceiling, pending: true, evaluation_version: evaluationVersion(phase), ...extra };
  records.push(entry); persist(); update();
  try {
    const data = await getChatCompletion(endpoint, messages, effective, key, undefined, undefined, controller?.signal, { auxiliary: true });
    const usage = data.usage;
    if (!usage || typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number') throw new Error('APIが使用トークンを返さないため停止します。');
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
function replacement(item: any, text: string, apply = applyBubbleSummariesForSubmit) {
  const messages = messagesFor(item.input);
  const chat = { id: 'experiment', title: item.id, titleSet: true, imageDetail: 'auto', config: base, messages, summaries: [{ id: 'summary', mode: messages.length === 1 ? 'single' : 'range', text, useForSubmit: true, sources: messages.map((m, i) => ({ nodeId: String(i), parentId: null, role: m.role, textParts: m.content.map((v: any) => v.text) })) }] } as ChatInterface;
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
    if (phase.startsWith('downstream')) {
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
    await parallel(jobs, phase === 'free' ? 1 : 2);
  } catch (error) { controller.abort(); $('progress').textContent += '\n' + String(error).replace(/"user_id"\s*:\s*"[^"]*"/g, '"user_id":"[redacted]"'); }
  finally { controller = undefined; ($('run') as HTMLButtonElement).disabled = false; ($('stop') as HTMLButtonElement).disabled = true; $('status').textContent = `終了 · ${records.length}送信記録 · 計上費用 $${cost().toFixed(4)} / $10`; }
};
$('stop').onclick = () => controller?.abort();
$('download').onclick = () => {
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: 1, cost_cap_usd: 10, records }, null, 2)], { type: 'application/json' }));
  link.href = url; link.download = 'bubble-summary-api-results.json'; link.click(); URL.revokeObjectURL(url);
};
update();
