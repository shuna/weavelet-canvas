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
  if (!url.startsWith('weavelet-classifier://bundle/')) { self.postMessage({id:-1,type:'classifierBlockedFetch',url}); return Promise.reject(Error('Offline classifier blocked fetch: ' + url)); }
  return originalFetch(input, init);
};
// HF captures its fetch hook during import; bind that hook to the same offline gate.
env.fetch = globalThis.fetch;
await import('../../src/workers/transformersWorker');
const classify = self.onmessage!;
self.onmessage = event => {
  if (event.data.type === 'classify' && event.data.observeInput) {
    const text = event.data.text;
    self.postMessage({id:-1,type:'classifierInput',utf16:Array.from({length:text.length},(_,i)=>text.charCodeAt(i)),utf8:Array.from(new TextEncoder().encode(text))});
  }
  return classify(event);
};
self.postMessage({id: 0, type: 'runtimeReady', version: env.version});
