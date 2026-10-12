import { resolveStrict } from '../../src/store/storage/google/records';
import { resolveDeltaContentJSON } from '../../src/utils/contentStore';
import { v3DocumentLayout, projectSyncDocument, applySyncDocumentEdits, mergeSyncDocumentSnapshot } from '../../src/utils/syncDocument';
export { createSyncDocument, projectSyncDocument, applySyncDocumentEdits, mergeSyncDocumentSnapshot, publicationSnapshot, v3DocumentLayout } from '../../src/utils/syncDocument';
// Bridge output is a UI projection or limited changes, never a replacement full snapshot.
export function documentOperation(json: string): string {
  const input = JSON.parse(json);
  switch (input.operation) {
    case 'resolveStore': return JSON.stringify(Object.fromEntries(Object.entries(input.store).filter(([hash,entry]:any) => entry.delta && (!input.hashes || input.hashes.includes(hash))).map(([hash]) => {
      if (input.strict) resolveStrict(input.store,hash);
      return [hash,resolveDeltaContentJSON(input.store,hash) ?? '[]'];
    })));
    case 'v3Layout': return JSON.stringify(v3DocumentLayout(input.v3));
    case 'project': return JSON.stringify(projectSyncDocument(input.document));
    case 'applyEdits': {
      let changes = applySyncDocumentEdits(input.document, input.before, input.edited,input.now).changes;
      for (const hash of input.deltaEntries ?? []) {
        const before = input.before.contentStore?.[hash], edited = input.edited.contentStore?.[hash];
        if (edited && !orderedJSONEqual(before?.content,edited.content)) {
          const contentPath = ['snapshot','state','contentStore',hash,'content'];
          changes = changes.filter(change => !contentPath.every((part,index) => change.path[index] === part));
          changes.push({op:'set',path:contentPath,value:edited.content});
          changes.push({op:'remove',path:['snapshot','state','contentStore',hash,'delta']});
        }
      }
      return JSON.stringify(changes);
    }
    case 'importV3': {
      const layout = v3DocumentLayout(input.v3);
      mergeSyncDocumentSnapshot(input.document, {version:input.document.snapshot.version,state:{}}); // validate the existing namespace
      return JSON.stringify([
        ...layout.sharedRoots.map(key => ({op:'set',path:['snapshot','state',key],source:'v3',sourcePath:[key]})),
        ...layout.sidecarRoots.map(key => ({op:'set',path:['v3Sidecar',key],source:'v3',sourcePath:[key]})),
      ]);
    }
    case 'mergeSnapshot': {
      mergeSyncDocumentSnapshot(input.document, input.incoming); // validate the same pure operation
      // Every present input root is a raw replacement, even when JS numbers compare equal.
      // Missing roots leave the previous document untouched, and null is a replacement value.
      const changes = Object.keys(input.incoming).filter(key => key !== 'state').map(key => ({
        op: 'set', path: ['snapshot', key], source: 'incoming', sourcePath: [key],
      }));
      changes.push(...Object.keys(input.incoming.state).map(key => ({
        op: 'set', path: ['snapshot', 'state', key], source: 'incoming', sourcePath: ['state', key],
      })));
      return JSON.stringify(changes);
    }
    default: throw new Error('Unsupported document operation.');
  }
}

import { readMessageAttributes, extraMessageAttributes, setMessageAttributes, copyMessageAttributes, captureProjectedMessageAttributes, projectMessageAttributes, materializeActivePath } from '../../src/utils/branchUtils';
import { diffJSONChanges, orderedJSONEqual } from '../../src/utils/jsonChanges';
export function messageAttributesOperation(json: string): string {
  const input = JSON.parse(json);
  switch (input.operation) {
    case 'captureDocument':
    case 'exportDocument': {
      const changed = structuredClone(input.source);
      for (const chat of changed.chats) {
        if (input.operation === 'captureDocument') captureProjectedMessageAttributes(chat, changed.contentStore);
        const attributes = chat.branchTree && readMessageAttributes(chat.branchTree);
        if (input.operation === 'exportDocument' && attributes)
          chat.messages = materializeActivePath(chat.branchTree, changed.contentStore, true);
      }
      if (changed.branchClipboard != null) readMessageAttributes(changed.branchClipboard);
      return JSON.stringify(diffJSONChanges(input.source,changed));
    }
    case 'read': return JSON.stringify(readMessageAttributes(input.owner)?.byNode ?? null);
    case 'extras': return JSON.stringify(extraMessageAttributes(input.message));
    case 'setting': {
      const changed = structuredClone(input.owner);
      setMessageAttributes(changed,input.nodeID,input.message);
      return JSON.stringify(diffJSONChanges(input.owner,changed));
    }
    case 'copying': {
      const changed = structuredClone(input.target);
      copyMessageAttributes(input.source,input.nodeID,changed,input.newID);
      return JSON.stringify(diffJSONChanges(input.target,changed));
    }
    case 'capture': {
      const changed = structuredClone(input.chat);
      captureProjectedMessageAttributes(changed,input.store);
      return JSON.stringify(diffJSONChanges(input.chat,changed));
    }
    case 'projecting': return JSON.stringify(projectMessageAttributes(input.owner,input.nodeID,input.message));
    default: throw new Error('Unsupported message attributes operation.');
  }
}
