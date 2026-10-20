import { fetchCloudKitRecord, getCloudKitConfig } from '@api/cloudkit';
import useCloudAuthStore from '@store/cloud-auth-store';
import { cloudKitSessionGuard } from '@store/storage/cloud/providers/cloudkit';
import { LEGACY_IOS_CLOUDKIT_SOURCE } from './legacyIOSSync';

export type LegacyIOSCloudKitFile = { file: File; snapshotVersion: unknown; isCurrent: () => boolean };

/** Reads the separate old record without touching the current sync target or baseline. */
export async function fetchLegacyIOSCloudKitFile(isActive: () => boolean): Promise<LegacyIOSCloudKitFile | null> {
  const config = getCloudKitConfig();
  const state = useCloudAuthStore.getState();
  const session = state.providers.cloudkit;
  if (!config || state.provider !== 'cloudkit' || !state.cloudSync || !session.sessionToken || session.syncStatus === 'unauthenticated') {
    throw new Error('CloudKitへの再接続が必要です。');
  }
  if (!session.connectionId) state.setProviderSession('cloudkit', { connectionId: crypto.randomUUID() });
  const sameConnection = cloudKitSessionGuard({ accessToken: session.sessionToken, fileId: LEGACY_IOS_CLOUDKIT_SOURCE.recordName });
  const isCurrent = () => {
    const current = useCloudAuthStore.getState();
    return isActive() && current.provider === 'cloudkit' && current.cloudSync && current.providers.cloudkit.syncStatus !== 'unauthenticated' && sameConnection();
  };
  const result = await fetchCloudKitRecord(config, session.sessionToken, LEGACY_IOS_CLOUDKIT_SOURCE.recordName);
  if (!isCurrent()) throw new Error('取得中にCloudKitの接続が変更されました。');
  if (result.newWebAuthToken) useCloudAuthStore.getState().setProviderSession('cloudkit', { sessionToken: result.newWebAuthToken });
  if (!result.record) return null;
  if (result.record.recordName !== LEGACY_IOS_CLOUDKIT_SOURCE.recordName || result.record.recordType !== LEGACY_IOS_CLOUDKIT_SOURCE.recordType) {
    throw new Error('旧iOSデータのレコードが一致しません。');
  }
  const payload = result.record.fields?.payload;
  if (!payload || typeof payload.value !== 'string' || (payload.type !== undefined && payload.type !== 'BYTES')) {
    throw new Error('旧iOSデータに読み取り可能な本文がありません。');
  }
  const binary = atob(payload.value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const container = bytes[0] === 0x54 && bytes[1] === 0x4c && bytes[2] === 0x56 && bytes[3] === 0x57;
  const file = new File([bytes], `${LEGACY_IOS_CLOUDKIT_SOURCE.recordName}.${container ? 'wvlt' : 'json'}`, {
    type: container ? 'application/octet-stream' : 'application/json',
  });
  return { file, snapshotVersion: result.record.fields?.snapshotVersion?.value, isCurrent };
}

export function downloadLegacyIOSCloudKitFile(snapshot: LegacyIOSCloudKitFile): void {
  if (!snapshot.isCurrent()) throw new Error('CloudKitの接続が変更されました。再取得してください。');
  const url = URL.createObjectURL(snapshot.file);
  const link = document.createElement('a');
  link.href = url;
  link.download = snapshot.file.name;
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function assertLegacyIOSCloudKitPreview(snapshot: LegacyIOSCloudKitFile): void {
  if (!snapshot.isCurrent()) throw new Error('CloudKitの接続が変更されました。再取得してください。');
  if (snapshot.snapshotVersion !== LEGACY_IOS_CLOUDKIT_SOURCE.snapshotVersion) {
    throw new Error('この版の旧iOSデータは内容を確認できません。原本を保存してください。');
  }
}
