// Native loading boundary only. Classification and output normalization remain the actual Web worker.
import { env } from '@huggingface/transformers';
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: 'weavelet-classifier://bundle/ort-wasm-simd-threaded.mjs',
  wasm: 'weavelet-classifier://bundle/ort-wasm-simd-threaded.wasm',
};
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('weavelet-classifier://bundle/')) { self.postMessage({id:-1,type:'proofBlockedFetch',url}); return Promise.reject(Error('Offline proof blocked fetch: ' + url)); }
  return originalFetch(input, init);
};
// HF captures its fetch hook during import; bind that hook to the same offline gate.
env.fetch = globalThis.fetch;
await import('../../src/workers/transformersWorker');
self.postMessage({id: 0, type: 'runtimeReady', version: env.version});
