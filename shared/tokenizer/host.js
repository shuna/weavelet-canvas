let worker, workerURL, epoch = 0;
const post = (generation, value) => window.webkit.messageHandlers.tokenizerHost.postMessage({ epoch: generation, json: JSON.stringify(value) });
window.tokenizerHost = {
  async boot() {
    const generation = ++epoch;
    const code = await (await fetch('weavelet-tokenizer://bundle/worker.js')).text();
    if (generation !== epoch) return;
    workerURL = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    worker = new Worker(workerURL, { type: 'module' });
    worker.onmessage = ({ data }) => { if (generation === epoch) post(generation, data); };
    worker.onerror = event => { if (generation === epoch) post(generation, { id: 0, type: 'error', message: event.message || 'Tokenizer Worker failed' }); };
  },
  send(json) {
    const request = JSON.parse(json);
    if (!worker) throw Error('Tokenizer Worker closed');
    worker.postMessage(request);
  },
  state() { return { workerAlive: !!worker, epoch }; },
  cancel() {
    ++epoch;
    worker?.terminate(); worker = null;
    if (workerURL) URL.revokeObjectURL(workerURL);
    workerURL = null;
  },
};
window.addEventListener('pagehide', () => window.tokenizerHost.cancel());
window.tokenizerHost.boot().catch(error => post(epoch, { id: 0, type: 'error', message: error.message }));
