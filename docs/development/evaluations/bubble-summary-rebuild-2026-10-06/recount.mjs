// Recount saved synthetic requests with a ready encoder; never reads browser storage or calls an API.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Tiktoken } from '@dqbd/tiktoken/lite';

const directory = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const compiled = await build({ entryPoints: [root + 'src/utils/tokenizerSerialization.ts'], bundle: true, write: false, platform: 'node', format: 'esm', alias: { '@type/chat': root + 'src/types/chat.ts' } });
const { serializeMessagesForTokenCount } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const encoding = createRequire(import.meta.url)('@dqbd/tiktoken/encoders/cl100k_base.json');
const encoder = new Tiktoken(encoding.bpe_ranks, { ...encoding.special_tokens, '<|im_start|>': 100264, '<|im_end|>': 100265, '<|im_sep|>': 100266 }, encoding.pat_str);
const count = (messages, model) => encoder.encode(serializeMessagesForTokenCount(messages, model), 'all').length;
const rows = [];
for (const filename of (await fs.readdir(directory)).filter(name => name.endsWith('-results.json'))) {
  for (const record of JSON.parse(await fs.readFile(directory + filename, 'utf8'))) {
    if (!record.condition?.startsWith('follow-candidate') || !record.output || !record.source) continue;
    const original = (Array.isArray(record.source) ? record.source : [record.source]).map(message => ({ role: message.role, content: [{ type: 'text', text: message.content }] }));
    const originalTokens = count(original, record.config.model);
    const replacementTokens = count(record.input.slice(0, -1), record.config.model);
    rows.push({ filename, response_id: record.response_id, case_id: record.case_id, repeat: record.repeat, probe: record.probe, originalTokens, replacementTokens, ready_encoder_selection: replacementTokens < originalTokens ? 'compact' : 'original', recorded_originalTokens: record.originalTokens, recorded_replacementTokens: record.replacementTokens, recorded_selection: record.candidate_automatic_selection });
  }
}
encoder.free();
await fs.writeFile(directory + 'token-recount.json', JSON.stringify({ method: 'ready cl100k_base using repository serialization; not an Anthropic tokenizer', rows }, null, 2) + '\n');
console.log(JSON.stringify({ rows: rows.length, compact: rows.filter(row => row.ready_encoder_selection === 'compact').length, changedSelection: rows.filter(row => row.recorded_selection && row.recorded_selection !== row.ready_encoder_selection).length }));
