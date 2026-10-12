// These imports only belong to the unused Web codec; native SyncRecords owns conversion.
export function addContent(): never { throw new Error('Use the native records codec'); }
export function computeContentHash(): never { throw new Error('Use the native records codec'); }
export default class UnusedDelta {}
