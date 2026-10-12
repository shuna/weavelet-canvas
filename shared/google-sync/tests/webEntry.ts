export { EncryptedDriveSync } from '../source/sync';
export { encode, decode, encrypt, decrypt, unlockKey, digest } from '../source/crypto';
export { toRecords, fromRecords, diffRecords } from '../source/records';
export { replayHistory } from '../source/replay';
export { DriveNotFoundError } from '../adapters/transport';
