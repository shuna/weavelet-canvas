import { isEqual as sameValues } from 'lodash';
import { recordChatEdits, hasFolderContentEdits } from '@store/chat-edit-time';
import { captureProjectedMessageAttributes, materializeActivePath } from '@utils/branchUtils';
import { resolveContent, type ContentStoreData } from '@utils/contentStore';
import { STORE_VERSION } from '@store/version';
import type { ChatInterface } from '@type/chat';

export const DOCUMENT_SHARED_ROOTS = ['chats', 'contentStore', 'folders', 'evaluationSettings', 'evaluationResults'] as const;
type ObjectValue = Record<string, any>;
export interface SyncDocumentData { snapshot: { version: number; state: ObjectValue; [key: string]: any }; v3Sidecar: ObjectValue }
import { diffJSONChanges, orderedJSONEqual as isEqual } from './jsonChanges';
export type { DocumentPatch } from './jsonChanges';
const has = (value: ObjectValue, key: string) => Object.hasOwn(value, key);
const object = (value: any, name: string): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${name}.`);
  return value;
};
const shared = (key: string) => DOCUMENT_SHARED_ROOTS.some(root => root === key);
const sidecarOf = (v3: ObjectValue) => Object.fromEntries(Object.entries(v3).filter(([key]) => key !== 'version' && !shared(key)));
function validate(document: SyncDocumentData) {
  object(document.snapshot, 'snapshot'); object(document.snapshot.state, 'snapshot state'); object(document.v3Sidecar, 'V3 sidecar');
  if (!Number.isInteger(document.snapshot.version)) throw new Error('Invalid snapshot version.');
  if (Object.keys(document.v3Sidecar).some(key => key === 'version' || shared(key))) throw new Error('Invalid V3 sidecar roots.');
}
function v3Object(v3: any) {
  object(v3, 'V3 document');
  if (v3.version !== 3) throw new Error('Unsupported V3 document version.');
}
// Native callers move these original raw roots into containers without reserializing values.
export function v3DocumentLayout(v3: ObjectValue) {
  v3Object(v3);
  return { version: STORE_VERSION, sharedRoots: Object.keys(v3).filter(shared), sidecarRoots: Object.keys(sidecarOf(v3)) };
}
export function createSyncDocument(input: { snapshot: SyncDocumentData['snapshot']; v3Sidecar?: ObjectValue } | { v3: ObjectValue }): SyncDocumentData {
  let result: SyncDocumentData;
  if ('snapshot' in input) result = { snapshot: structuredClone(input.snapshot), v3Sidecar: structuredClone(input.v3Sidecar ?? {}) };
  else {
    v3Object(input.v3);
    result = { snapshot: { version: STORE_VERSION, state: Object.fromEntries(Object.entries(input.v3).filter(([key]) => shared(key))) }, v3Sidecar: sidecarOf(input.v3) };
    result = structuredClone(result);
  }
  validate(result); return result;
}
export function projectSyncDocument(document: SyncDocumentData): ObjectValue {
  validate(document);
  const state = document.snapshot.state;
  const store = object(state.contentStore ?? {}, 'content store') as ContentStoreData;
  const expanded = Object.fromEntries(Object.entries(store).map(([hash, entry]) => {
    const { delta: _delta, ...metadata } = entry;
    return [hash, { ...structuredClone(metadata), content: structuredClone(resolveContent(store, hash)) }];
  }));
  const chats: ChatInterface[] = structuredClone(state.chats ?? []);
  if (!Array.isArray(chats)) throw new Error('Invalid chats.');
  for (const chat of chats) if (chat.branchTree) {
    captureProjectedMessageAttributes(chat, store);
    chat.messages = materializeActivePath(chat.branchTree, store, true);
  }
  const projection = { ...structuredClone(document.v3Sidecar), version: 3 } as ObjectValue;
  for (const root of DOCUMENT_SHARED_ROOTS) if (has(state, root)) projection[root] = structuredClone(state[root]);
  return { ...projection, chats, contentStore: expanded, folders: projection.folders ?? {} };
}
function result(before: SyncDocumentData, document: SyncDocumentData) {
  const persisted = JSON.parse(JSON.stringify(document)) as SyncDocumentData;
  const changes = diffJSONChanges(before, persisted);
  return { document: persisted, changes };
}
export function applySyncDocumentEdits(document: SyncDocumentData, before: ObjectValue, edited: ObjectValue, now = Date.now()) {
  validate(document); v3Object(edited);
  if (!sameValues(before, projectSyncDocument(document))) throw new Error('Stale document projection.');
  const next = structuredClone(document), state = next.snapshot.state;
  for (const root of DOCUMENT_SHARED_ROOTS) {
    if (has(before, root) === has(edited, root) && isEqual(before[root], edited[root])) continue;
    if (!has(edited, root)) { delete state[root]; continue; }
    if (root === 'contentStore' && edited[root] !== null) {
      state[root] = Object.fromEntries(Object.entries(object(edited[root], root)).map(([hash, entry]) => {
        const original = document.snapshot.state[root]?.[hash];
        if (original && isEqual(before[root]?.[hash], entry)) return [hash, structuredClone(original)];
        const updated = structuredClone(object(entry, 'content entry'));
        if (original?.delta && isEqual(before[root]?.[hash]?.content, updated.content)) {
          updated.content = structuredClone(original.content); updated.delta = structuredClone(original.delta);
        }
        return [hash, updated];
      }));
    } else if (root === 'chats' && Array.isArray(edited[root])) {
      state[root] = edited[root].map((chat: ObjectValue) => {
        const original = document.snapshot.state.chats?.find((item: ObjectValue) => item.id === chat.id), previous = before.chats?.find((item: ObjectValue) => item.id === chat.id);
        const updated = structuredClone(chat);
        if (!original || original.id !== chat.id) return updated;
        for (const key of Object.keys(updated)) if (has(previous, key) && isEqual(previous[key], updated[key])) {
          if (has(original, key)) updated[key] = structuredClone(original[key]); else delete updated[key];
        }
        return updated;
      });
    } else state[root] = structuredClone(edited[root]);
  }
  const edits = Array.isArray(state.chats) && !isEqual(before.chats, edited.chats)
    ? recordChatEdits(before.chats, state.chats, now) : undefined;
  const foldersEdited = has(edited,'folders') && !isEqual(before.folders,edited.folders) &&
    hasFolderContentEdits(before.folders ?? {}, edited.folders ?? {});
  if (edits) state.chats = edits.chats;
  if (edits?.changed || foldersEdited) state.lastContentEditedAt = now;
  // A partial V3 refresh does not erase previously imported sidecar roots.
  next.v3Sidecar = { ...next.v3Sidecar, ...structuredClone(sidecarOf(edited)) };
  return result(document, next);
}
export function mergeSyncDocumentSnapshot(document: SyncDocumentData, incoming: SyncDocumentData['snapshot']) {
  validate(document); createSyncDocument({ snapshot: incoming });
  // Web mergePersistedStoreState/prepareHydratedData overlay only present roots.
  // Preserve explicit null in the persisted source; projection defaults are separate.
  const next = { snapshot: { ...structuredClone(document.snapshot), ...structuredClone(incoming), state: { ...structuredClone(document.snapshot.state), ...structuredClone(incoming.state) } }, v3Sidecar: structuredClone(document.v3Sidecar) };
  return result(document, next);
}
export const publicationSnapshot = (document: SyncDocumentData) => { validate(document); return structuredClone(document.snapshot); };
