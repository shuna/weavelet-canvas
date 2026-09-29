import { encode } from './crypto';
import { getSyncMetrics } from './metrics';
self.onmessage = ({ data }) => {
  const bytes = encode(data);
  self.postMessage({ bytes, metrics: getSyncMetrics() }, { transfer: [bytes.buffer] });
};
