const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== 'weavelet-tokenizer://bundle/tiktoken_bg.wasm') return Promise.reject(Error('Offline tokenizer resource denied'));
  return originalFetch(input, init);
};
await import('../../src/workers/tokenizerWorker');
self.postMessage({ id: 0, type: 'runtimeReady' });
