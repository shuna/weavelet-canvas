let worker, workerURL, epoch = 0;
const post = value => window.webkit.messageHandlers.classifierProof.postMessage(value);
window.classifierProof = {
  async boot() {
    const generation = ++epoch;
    const code = await (await fetch('weavelet-classifier://bundle/worker.js')).text();
    if (generation !== epoch) return;
    workerURL = URL.createObjectURL(new Blob([code], {type: 'text/javascript'}));
    worker = new Worker(workerURL, {type: 'module'});
    worker.onmessage = ({data}) => {
      if (generation !== epoch) return;
      post(data);
      if (data.type === 'unloaded') this.cancel();
    };
    worker.onerror = event => post({id:0,type:'error',message:event.message || 'Worker loading failed'});
  },
  async send(request) {
    if (request.type === 'loadClassifier' || request.type === 'loadClassifierMissing') {
      const missing = request.type === 'loadClassifierMissing'; request.type = 'loadClassifier';
      const files = ['config.json','tokenizer.json','tokenizer_config.json','onnx/model_quantized.onnx'];
      request.modelId = 'proof';
      request.fileEntries = await Promise.all(files.filter(name => !missing || name !== 'onnx/model_quantized.onnx').map(async name => [name, new Blob([await (await fetch('weavelet-classifier://bundle/model/' + name)).arrayBuffer()])]));
    }
    worker.postMessage(request);
  },
  state() { return {workerAlive: !!worker, epoch}; },
  cancel() {
    ++epoch;
    worker?.terminate(); worker = null;
    if (workerURL) URL.revokeObjectURL(workerURL);
    workerURL = null;
  },
};
window.addEventListener('pagehide', () => window.classifierProof.cancel());
window.classifierProof.boot().catch(error => post({id:0,type:'error',message:error.message}));
