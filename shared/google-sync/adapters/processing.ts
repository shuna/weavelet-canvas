import { encode, decode } from './crypto';
import { hashRecords, toRecords, fromRecords } from '../source/records';
import { collectHistory, replayHistory, hashCommits } from '../source/replay';
import { decodeParts } from '../source/decodeParts';
export const encodeAsync = async (value: unknown) => encode(value);
export const decodeAsync = async <T>(value: Uint8Array) => decode<T>(value);
export const toRecordsAsync = toRecords;
export const fromRecordsAsync = fromRecords;
export const hashRecordsAsync = hashRecords;
let yieldHistory: () => Promise<void>;
export const setHistoryYield = (yieldTask: () => Promise<void>) => { yieldHistory = yieldTask; };
export const replayHistoryAsync = (value: Parameters<typeof replayHistory>[0]) => replayHistory(value, undefined, yieldHistory);
export const collectHistoryAsync = (value: Parameters<typeof collectHistory>[0]) => collectHistory(value, undefined, yieldHistory);
export const decodePartsAsync = async <T>(value: Uint8Array[]) => decodeParts<T>(value);

export const hashCommitsAsync = hashCommits;
