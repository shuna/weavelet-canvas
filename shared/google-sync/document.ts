import { withoutBrowserLocalSettings } from '../../src/store/storage/google/settings';
import { STORE_VERSION } from '../../src/store/version';
import { projectSyncDocument } from '../../src/utils/syncDocument';
import { resolveStrict } from '../../src/store/storage/google/records';
import { resolveDeltaContentJSON } from '../../src/utils/contentStore';
import { v3DocumentLayout, applySyncDocumentEdits, mergeSyncDocumentSnapshot } from '../../src/utils/syncDocument';
export { createSyncDocument, projectSyncDocument, applySyncDocumentEdits, mergeSyncDocumentSnapshot, publicationSnapshot, v3DocumentLayout } from '../../src/utils/syncDocument';
// Bridge output is a UI projection or limited changes, never a replacement full snapshot.
export function documentOperation(json: string): string {
  const input = JSON.parse(json);
  switch (input.operation) {
    case 'resolveStore': return JSON.stringify(Object.fromEntries(Object.entries(input.store).filter(([hash,entry]:any) => entry.delta && (!input.hashes || input.hashes.includes(hash))).map(([hash]) => {
      if (input.strict) resolveStrict(input.store,hash);
      return [hash,resolveDeltaContentJSON(input.store,hash) ?? '[]'];
    })));
    case 'syncSnapshot': {
      if (input.received.version !== STORE_VERSION) throw new Error('The downloaded snapshot uses a different data version; it was preserved without replacing local chats.');
      const shared = withoutBrowserLocalSettings(input.received.state);
      const next = mergeSyncDocumentSnapshot(input.document,{...input.received,state:shared}).document;
      if (shared.contentStore) {
        const expanded = projectSyncDocument(input.document).contentStore;
        for (const [hash,entry] of Object.entries(shared.contentStore)) {
          if (orderedJSONEqual(expanded[hash],entry) && input.document.snapshot.state.contentStore?.[hash])
            next.snapshot.state.contentStore[hash] = input.document.snapshot.state.contentStore[hash];
        }
      }
      const original = input.document.snapshot;
      const replacedChats = new Set<number>();
      const changes = diffJSONChanges(original,next.snapshot).flatMap(change => {
        if (change.path[0] === 'state' && change.path[1] === 'chats' && typeof change.path[2] === 'number') {
          const index = change.path[2], chat = next.snapshot.state.chats[index];
          if (chat && original.state.chats?.[index]?.id !== chat.id) {
            if (replacedChats.has(index)) return [];
            replacedChats.add(index);
            return [{op:'set' as const,path:['state','chats',index],value:chat}];
          }
        }
        return [change];
      }).map(change => {
        if (change.op !== 'set') return change;
        let sourcePath = [...change.path];
        // Chat position is a UI order; retained raw values follow immutable chat IDs.
        if (sourcePath[0] === 'state' && sourcePath[1] === 'chats' && typeof sourcePath[2] === 'number') {
          const chat = next.snapshot.state.chats[sourcePath[2]];
          const index = original.state.chats?.findIndex((item:any) => item.id === chat.id) ?? -1;
          if (index < 0) return change;
          sourcePath[2] = index;
        }
        const read = (path:(string|number)[]) => path.reduce((value,key) => value?.[key],original);
        const rawSources: {path:(string|number)[];sourcePath:(string|number)[]}[] = [];
        const protect = (value:any,path:(string|number)[],source:(string|number)[]):any => {
          const previous = read(source);
          if (previous !== undefined && orderedJSONEqual(previous,value)) {
            rawSources.push({path,sourcePath:source}); return null;
          }
          if (Array.isArray(value)) return value.map((item,index) => protect(item,[...path,index],[...source,index]));
          if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,protect(item,[...path,key],[...source,key])]));
          return value;
        };
        const value = protect(change.value,[],sourcePath);
        return {...change,value,rawSources};
      });
      return JSON.stringify(changes);
    }
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
