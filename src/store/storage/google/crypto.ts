import { recordMetric } from './metrics';
import { compressToUint8Array, decompressFromUint8Array } from 'lz-string';

const encoder = new TextEncoder();
const ITERATIONS = 600_000;
export interface KeyEnvelope {
  format: 'weavelet-encrypted-sync';
  version: 1;
  salt: number[];
  iterations: number;
  wrappedKey: number[];
}

export async function digest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0')).join('');
}

async function passwordKey(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

// Bind ciphertext to its dataset and file ID to reject file substitution.
export async function encrypt(key: CryptoKey, bytes: Uint8Array, context: string): Promise<Uint8Array> {
  const started = performance.now();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context), tagLength: 128 }, key, bytes
  ));
  const result = new Uint8Array(iv.length + ciphertext.length);
  result.set(iv);
  result.set(ciphertext, iv.length);
  recordMetric('encrypt', started, bytes.length, result.length);
  return result;
}

export async function decrypt(key: CryptoKey, bytes: Uint8Array, context: string): Promise<Uint8Array> {
  const started = performance.now();
  if (bytes.length < 28) throw new Error('Invalid encrypted sync file.');
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(context), tagLength: 128 },
      key, bytes.slice(12)
    ));
  } catch {
    throw new Error('Unable to decrypt sync data: incorrect passphrase or damaged file.');
  } finally { recordMetric('decrypt', started, bytes.length); }
}

export async function createKeyEnvelope(password: string, dataset: string) {
  if (password.length < 12) throw new Error('Use a sync passphrase of at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const wrappingKey = await passwordKey(password, salt, ITERATIONS);
  const envelope: KeyEnvelope = {
    format: 'weavelet-encrypted-sync', version: 1, salt: [...salt], iterations: ITERATIONS,
    wrappedKey: [...await encrypt(wrappingKey, raw, `${dataset}:key`)],
  };
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  raw.fill(0);
  return { key, envelope };
}

export async function unlockKey(envelope: KeyEnvelope, password: string, dataset: string): Promise<CryptoKey> {
  const bytes = (value: unknown, length: number) => Array.isArray(value) && value.length === length &&
    value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  if (envelope?.format !== 'weavelet-encrypted-sync' || envelope.version !== 1 ||
      envelope.iterations !== ITERATIONS || !bytes(envelope.salt, 16) || !bytes(envelope.wrappedKey, 60)) {
    throw new Error('Unsupported encrypted sync format.');
  }
  const wrappingKey = await passwordKey(password, new Uint8Array(envelope.salt), envelope.iterations);
  const raw = await decrypt(wrappingKey, new Uint8Array(envelope.wrappedKey), `${dataset}:key`);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  raw.fill(0);
  return key;
}

export const encode = (value: unknown): Uint8Array => {
  const started = performance.now();
  const json = JSON.stringify(value);
  const size = encoder.encode(json).length;
  recordMetric('serialize', started, size, size);
  const compressStarted = performance.now();
  const bytes = compressToUint8Array(json);
  recordMetric('compress', compressStarted, size, bytes.length);
  return bytes;
};
export function decode<T>(bytes: Uint8Array): T {
  const json = decompressFromUint8Array(bytes);
  if (!json) throw new Error('Invalid compressed sync data.');
  return JSON.parse(json) as T;
}
