import { host, bytes } from './host';
export const digest = async (value: string | Uint8Array) => host('digest', typeof value === 'string' ? value : bytes(value));
export const encode = (value: unknown) => new Uint8Array(host('encode', value));
export const decode = <T>(value: Uint8Array): T => host('decode', bytes(value));
export const encrypt = async (key: unknown, value: Uint8Array, context: string) => new Uint8Array(host('encrypt', key, bytes(value), context));
export const decrypt = async (key: unknown, value: Uint8Array, context: string) => new Uint8Array(host('decrypt', key, bytes(value), context));
export const createKeyEnvelope = async (password: string, dataset: string) => host('createKeyEnvelope', password, dataset);
export const unlockKey = async (envelope: unknown, password: string, dataset: string) => host('unlockKey', envelope, password, dataset);
