import { encode, decode } from './crypto';
import { hashRecords, toRecords, fromRecords } from '../source/records';
import { replayHistory, hashCommits } from '../source/replay';
import { decodeParts } from '../source/decodeParts';
export const encodeAsync = async (value: unknown) => encode(value);
export const decodeAsync = async <T>(value: Uint8Array) => decode<T>(value);
export const toRecordsAsync = toRecords;
export const fromRecordsAsync = fromRecords;
export const hashRecordsAsync = hashRecords;
export const replayHistoryAsync = replayHistory;
export const decodePartsAsync = async <T>(value: Uint8Array[]) => decodeParts<T>(value);

export const hashCommitsAsync = hashCommits;
