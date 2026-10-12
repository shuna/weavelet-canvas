import { readImportFile } from './importService';
import { validateExportV1, validateExportV2, validateExportV3 } from '@utils/import';
import { flatMessagesToBranchTree } from '@utils/branchUtils';
import { addContent, type ContentStoreData } from '@utils/contentStore';
import type { ExportV1, ExportV2, ExportV3 } from '@type/export';
import type { BranchNodeLegacy } from '@type/chat';
import { STORE_VERSION } from '@store/version';
import type { Snapshot } from '@store/storage/google/records';
import { toRecordsAsync, fromRecordsAsync } from '@store/storage/google/processing';

export async function readDriveImportSnapshot(file: File): Promise<Snapshot> {
  const data = JSON.parse(await readImportFile(file)) as ExportV1 | ExportV2 | ExportV3;
  if (!data || ![1, 2, 3].includes(data.version) ||
      !(data.version === 3 ? validateExportV3(data as ExportV3)
        : data.version === 2 ? validateExportV2(data as ExportV2) : validateExportV1(data as ExportV1))) {
    throw new Error('Select a Weavelet V1, V2 or V3 export (.json or .json.gz).');
  }
  const contentStore: ContentStoreData = data.version === 3 ? (data as ExportV3).contentStore : {};
  for (const chat of data.chats ?? []) {
    if (!chat.branchTree) chat.branchTree = flatMessagesToBranchTree(chat.messages, contentStore);
    if (data.version === 2) for (const node of Object.values(chat.branchTree.nodes)) {
      const legacy = node as typeof node & { content?: BranchNodeLegacy['content'] };
      if (legacy.content && !node.contentHash) node.contentHash = addContent(contentStore, legacy.content);
      delete legacy.content;
    }
    if (chat.folder && !data.folders[chat.folder]) delete chat.folder;
  }
  const { version, ...state } = data;
  // Validate every branch/content reference before unlocking or writing anything to Drive.
  return fromRecordsAsync(await toRecordsAsync({ version: STORE_VERSION, state: { ...state, contentStore } }));
}
