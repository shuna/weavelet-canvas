let worker, workerURL, epoch = 0;
const post = value => window.webkit.messageHandlers.classifierHost.postMessage(value);
window.classifierHost = {
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
    const generation = epoch;
    if (request.type === 'loadClassifier') {
      const encode = path => path.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
      request.fileEntries = await Promise.all(request.names.map(async name => [name, new Blob([await (await fetch('weavelet-classifier://model/' + encode(name))).arrayBuffer()])]));
      delete request.names;
      if (generation !== epoch) return;
    }
    if (this.observeInputs && request.type === 'classify') request.observeInput = true;
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
window.addEventListener('pagehide', () => window.classifierHost.cancel());
window.classifierHost.boot().catch(error => post({id:0,type:'error',message:error.message}));
