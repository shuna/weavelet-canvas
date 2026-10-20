import { host, bytes } from './host';
import { recordMetric } from './metrics';
export const digest = async (value: string | Uint8Array) => host('digest', typeof value === 'string' ? value : bytes(value));
export const encode = (value: unknown) => new Uint8Array(host('encode', value));
export const decode = <T>(value: Uint8Array): T => host('decode', bytes(value));
export const encrypt = async (key: unknown, value: Uint8Array, context: string) => {
  const started = performance.now();
  const result = new Uint8Array(host('encrypt', key, bytes(value), context));
  recordMetric('encrypt', started, value.length, result.length);
  return result;
};
export const decrypt = async (key: unknown, value: Uint8Array, context: string) => {
  const started = performance.now();
  try { return new Uint8Array(host('decrypt', key, bytes(value), context)); }
  finally { recordMetric('decrypt', started, value.length); }
};
export const createKeyEnvelope = async (password: string, dataset: string) => host('createKeyEnvelope', password, dataset);
export const unlockKey = async (envelope: unknown, password: string, dataset: string) => host('unlockKey', envelope, password, dataset);
