// The old native writer uses a separate record; never use it as the current sync target.
export const LEGACY_IOS_CLOUDKIT_SOURCE = {
  recordName: 'weavelet-ios-snapshot',
  recordType: 'WeaveletSnapshot',
  snapshotVersion: 1,
} as const;
