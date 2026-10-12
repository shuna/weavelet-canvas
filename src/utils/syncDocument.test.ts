import { diff_match_patch } from 'diff-match-patch';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSyncDocument, projectSyncDocument, applySyncDocumentEdits, mergeSyncDocumentSnapshot, publicationSnapshot, type DocumentPatch } from './syncDocument';
import { documentOperation, messageAttributesOperation } from '../../shared/google-sync/document';
import { toRecords, fromRecords } from '@store/storage/google/records';
const now = 1700000000123;
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/web-native/${name}.json`, import.meta.url), 'utf8'));
vi.stubGlobal('crypto', webcrypto);
function apply(value: any, changes: DocumentPatch[]) {
  let result = structuredClone(value);
  for (const patch of changes) {
    let parent = result;
    for (const key of patch.path.slice(0, -1)) parent = parent[key];
    const key = patch.path.at(-1)!;
    if (patch.op === 'set') { if (!patch.path.length) result = structuredClone(patch.value); else parent[key] = structuredClone(patch.value); }
    if (patch.op === 'remove') { if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key]; }
    if (patch.op === 'keys') {
      const target = patch.path.length ? parent[key] : result;
      const ordered = Object.fromEntries(patch.keys.map(k => [k, target[k]]));
      if (patch.path.length) parent[key] = ordered; else result = ordered;
    }
  }
  return result;
}
describe('shared full-state document boundary', () => {
  it('keeps all full roots and isolates same-named V3-only roots without defaults on initial V3 import', () => {
    const corpus = fixture('io-corpus');
    const imported = createSyncDocument({ v3: corpus.exportV3 });
    expect(imported.snapshot.version).toBe(18);
    expect(Object.keys(imported.snapshot.state)).toEqual(Object.keys(corpus.exportV3).filter(k => ['chats','contentStore','folders','evaluationSettings','evaluationResults'].includes(k)));
    const document = createSyncDocument({ snapshot: corpus.syncSnapshot, v3Sidecar: { theme: 'V3-only', providers: { fake: 'V3-only' }, xSidecar: ['e\u0301', 'é'] } });
    const before = projectSyncDocument(document);
    const untouched = applySyncDocumentEdits(document, before, before);
    expect(untouched.changes).toEqual([]);
    expect(publicationSnapshot(untouched.document)).toEqual(corpus.syncSnapshot);
    expect(before.theme).toBe('V3-only');
    expect(Object.keys(document.snapshot.state)).toHaveLength(Object.keys(corpus.syncSnapshot.state).length);
  });
  it('uses Web branch attributes and content resolution only for display and preserves untouched delta/unreferenced entries', () => {
    const document = createSyncDocument({ snapshot: fixture('content-entry-wire').snapshot });
    const before = projectSyncDocument(document);
    expect(before.contentStore.delta).not.toHaveProperty('delta');
    expect(before.contentStore.unused).toBeDefined();
    const edited = structuredClone(before); edited.chats[0].title = '編集';
    const update = applySyncDocumentEdits(document, before, edited, now);
    expect(update.document.snapshot.state.contentStore).toEqual(document.snapshot.state.contentStore);
    expect(update.document.snapshot.state.chats[0].messages).toEqual(document.snapshot.state.chats[0].messages);
    expect(update.changes).toContainEqual({op:'set',path:['snapshot','state','chats',0,'title'],value:'編集'});
    expect(update.document.snapshot.state.chats[0].updatedAt).toBe(now);
    expect(update.document.snapshot.state.lastContentEditedAt).toBe(now);
    expect(apply(document, update.changes)).toEqual(update.document);
  });
  it('preserves delta encoding for metadata edits and updates only actually changed entry leaves', () => {
    const document = createSyncDocument({ snapshot: fixture('content-entry-wire').snapshot });
    const before = projectSyncDocument(document), edited = structuredClone(before);
    edited.contentStore.delta.xEdited = ['e\u0301', 'é', '🙂'];
    const update = applySyncDocumentEdits(document, before, edited, now);
    expect(update.document.snapshot.state.contentStore.delta.delta).toEqual(document.snapshot.state.contentStore.delta.delta);
    expect(update.document.snapshot.state.contentStore.delta.content).toEqual(document.snapshot.state.contentStore.delta.content);
    expect(update.changes.every(p => p.path[0] === 'snapshot' && p.path[2] === 'contentStore')).toBe(true);
    expect(update.changes.filter(p => p.op === 'set').map(p => p.path)).toEqual([['snapshot','state','contentStore','delta','xEdited']]);
    expect(apply(document, update.changes)).toEqual(update.document);
  });
  it('keeps message attributes, Unicode, clipboard/provider/unknown roots across native-style edits and Web records', async () => {
    const attrs = fixture('message-attributes');
    const snapshot = structuredClone(attrs.branchedSnapshot);
    snapshot.state.xFuture = { values: ['é', 'e\u0301'], order: [3,1,2] };
    snapshot.state.providers = { fake: { key: 'FAKE_SYNTHETIC_ONLY' } };
    const document = createSyncDocument({ snapshot, v3Sidecar: { xV3Only: 'preserve' } });
    const before = projectSyncDocument(document), edited = structuredClone(before);
    expect(before.chats[0].messages[0]).toMatchObject(attrs.expected.branchedAttributes.a ?? {});
    edited.chats[0].title = '編集';
    const update = applySyncDocumentEdits(document, before, edited, now);
    const restored = await fromRecords(await toRecords(publicationSnapshot(update.document)));
    expect((restored.state as Record<string, unknown>).xFuture).toEqual(snapshot.state.xFuture);
    expect(restored.state.providers).toEqual(snapshot.state.providers);
    expect(restored.state.branchClipboard).toEqual(snapshot.state.branchClipboard);
    expect(restored.state.chats![0].branchTree!.messageAttributesV1).toEqual({version:1,byNode:attrs.expected.branchedAttributes});
    expect(update.document.v3Sidecar).toEqual({xV3Only:'preserve'});
  });
  it('overlays only present snapshot roots and keeps explicit null in source separately from projection defaults', () => {
    const document = createSyncDocument({ snapshot: fixture('io-corpus').syncSnapshot, v3Sidecar: { future: { preserved: true } } });
    const update = mergeSyncDocumentSnapshot(document, { version: 99, state: { theme: null, contentStore: null, chats: null, branchClipboard: null, xIncoming: [3,2,1] } });
    expect(update.document.snapshot.version).toBe(99);
    expect(update.document.snapshot.state.contentStore).toBeNull();
    expect(projectSyncDocument(update.document).contentStore).toEqual({});
    expect(projectSyncDocument(update.document).chats).toEqual([]);
    expect(update.document.snapshot.state.providers).toEqual(document.snapshot.state.providers);
    expect(update.document.v3Sidecar).toEqual(document.v3Sidecar);
    expect(apply(document, update.changes)).toEqual(update.document);
  });
  it('retains old sidecar on partial V3 refresh, applies explicit removals, and emits ordered leaf/array patches', () => {
    const document = createSyncDocument({ snapshot: fixture('io-corpus').syncSnapshot, v3Sidecar: { xV3: [3,1,2] } });
    const before = projectSyncDocument(document), edited = structuredClone(before);
    delete edited.xV3; delete edited.evaluationResults;
    edited.chats.splice(0, 1);
    edited.folders = Object.fromEntries(Object.entries(edited.folders).reverse());
    const update = applySyncDocumentEdits(document, before, edited, now);
    expect(update.document.v3Sidecar).toEqual(document.v3Sidecar);
    expect(update.document.snapshot.state).not.toHaveProperty('evaluationResults');
    expect(update.changes.some(p => p.op === 'set' && p.path.join('.') === 'snapshot.state.chats')).toBe(false);
    expect(apply(document, update.changes)).toEqual(update.document);
    expect(Object.keys(apply(document, update.changes).snapshot.state.folders)).toEqual(Object.keys(edited.folders));
  });
  it('emits raw incoming source paths even when distinct large numbers parse to the same JS value', () => {
    const output = JSON.parse(documentOperation('{"operation":"mergeSnapshot","document":{"snapshot":{"version":18,"state":{"xNumber":9007199254740992,"keep":true}},"v3Sidecar":{"xV3":true}},"incoming":{"version":18,"state":{"xNumber":9007199254740993,"xNew":{"number":9007199254740995},"contentStore":null}}}'));
    expect(output).toEqual([
      {op:'set',path:['snapshot','version'],source:'incoming',sourcePath:['version']},
      {op:'set',path:['snapshot','state','xNumber'],source:'incoming',sourcePath:['state','xNumber']},
      {op:'set',path:['snapshot','state','xNew'],source:'incoming',sourcePath:['state','xNew']},
      {op:'set',path:['snapshot','state','contentStore'],source:'incoming',sourcePath:['state','contentStore']},
    ]);
    expect(output.every((p: any) => !Object.hasOwn(p, 'value'))).toBe(true);
    expect(JSON.parse(documentOperation(JSON.stringify({operation:'v3Layout',v3:{version:3,chats:[],xFuture:{number:9007199254740993}}})))).toEqual({version:18,sharedRoots:['chats'],sidecarRoots:['xFuture']});
  });
  it('returns edited leaf values with opaque references for native restoration', () => {
    const document = createSyncDocument({snapshot:fixture('content-entry-wire').snapshot});
    const before = projectSyncDocument(document), edited = structuredClone(before);
    edited.chats[0].title = '編集';
    const changes = JSON.parse(documentOperation(JSON.stringify({operation:'applyEdits',document,before,edited,now})));
    expect(changes).toContainEqual({op:'set',path:['snapshot','state','chats',0,'title'],value:'編集'});
    expect(changes).toContainEqual({op:'set',path:['snapshot','state','lastContentEditedAt'],value:now});
  });
  it('carries opaque raw values through chat deletion, order changes, clone/create and changed opaque roots', () => {
    const snapshot = structuredClone(fixture('content-entry-wire').snapshot);
    const chat = snapshot.state.chats[0]; chat.xRaw = {opaqueRef:0};
    const second = structuredClone(chat); second.id = 'second'; second.xRaw = {opaqueRef:1};
    snapshot.state.chats.push(second);
    snapshot.state.folders = {folder:{id:"folder",name:"name",order:0,expanded:false,xRaw:{opaqueRef:2}}};
    snapshot.state.xFuture = {opaqueRef:3};
    const document = createSyncDocument({snapshot,v3Sidecar:{xV3:{opaqueRef:4}}});
    const before = projectSyncDocument(document), edited = structuredClone(before);
    edited.chats.reverse();
    const clone = structuredClone(edited.chats[0]); clone.id = 'clone'; edited.chats.push(clone);
    edited.folders.folder.xRaw = {opaqueRef:5};
    const update = applySyncDocumentEdits(document,before,edited,now);
    expect(update.changes).toContainEqual({op:'set',path:['snapshot','state','folders','folder','xRaw'],value:{opaqueRef:5}});
    expect(update.changes.some(p => p.path.includes('opaqueRef'))).toBe(false);
    const changed = apply(document,update.changes);
    expect(changed.snapshot.state.chats.map((c:any)=>c.xRaw)).toEqual([{opaqueRef:1},{opaqueRef:0},{opaqueRef:1}]);
    expect(changed.snapshot.state.xFuture).toEqual({opaqueRef:3});
    expect(changed.v3Sidecar.xV3).toEqual({opaqueRef:4});
    const nextProjection = projectSyncDocument(changed), deleted = structuredClone(nextProjection);
    deleted.chats.splice(1,1);
    const deletion = applySyncDocumentEdits(changed,nextProjection,deleted);
    expect(apply(changed,deletion.changes).snapshot.state.chats.map((c:any)=>c.id)).toEqual(['second','clone']);
    expect(deletion.document.snapshot.state.contentStore).toEqual(snapshot.state.contentStore);
  });
  it('keeps explicit null display roots raw while supplying UI defaults without edits', () => {
    const document = createSyncDocument({snapshot:{version:18,state:{chats:null,contentStore:null,folders:null,theme:'local'}}});
    const before = projectSyncDocument(document);
    expect(before).toMatchObject({chats:[],contentStore:{},folders:{}});
    expect(applySyncDocumentEdits(document,before,before,now).changes).toEqual([]);
    expect(document.snapshot.state.folders).toBeNull();
  });
  it('uses actual Web content timestamps and leaves display-only changes unstamped', () => {
    const document = createSyncDocument({snapshot:{version:18,state:{chats:[],contentStore:{},folders:{f:{id:'f',name:'old',order:0,expanded:false}}}}});
    const before = projectSyncDocument(document), display = structuredClone(before);
    display.folders.f.expanded = true;
    expect(applySyncDocumentEdits(document,before,display,now).document.snapshot.state.lastContentEditedAt).toBeUndefined();
    const edited = structuredClone(before); edited.folders.f.name = 'new';
    expect(applySyncDocumentEdits(document,before,edited,now).document.snapshot.state.lastContentEditedAt).toBe(now);
  });
  it('captures and exports all chat attributes in one operation using the actual Web functions', () => {
    const snapshot = fixture('message-attributes').branchedSnapshot;
    const source = {chats:snapshot.state.chats,contentStore:snapshot.state.contentStore,branchClipboard:snapshot.state.branchClipboard};
    const captured = apply(source,JSON.parse(messageAttributesOperation(JSON.stringify({operation:'captureDocument',source}))));
    expect(captured.chats[0].branchTree.messageAttributesV1.byNode).toEqual(fixture('message-attributes').expected.branchedAttributes);
    const exported = apply(captured,JSON.parse(messageAttributesOperation(JSON.stringify({operation:'exportDocument',source:captured}))));
    expect(exported.chats[0].messages[0]).toMatchObject(fixture('message-attributes').expected.branchedAttributes.a);
    expect(exported.contentStore).toEqual(source.contentStore);
    const invalid = structuredClone(captured);
    invalid.branchClipboard = {nodes:{},messageAttributesV1:{version:2,byNode:{}}};
    expect(() => messageAttributesOperation(JSON.stringify({operation:'captureDocument',source:invalid}))).toThrow();
  });
  it('resolves raw delta attributes before opaque projection and removes a changed entry delta only', () => {
    const base = [{type:'text',text:'body',xLong:'A'.repeat(500)}], target = [{type:'text',text:'body',xLong:'B'.repeat(500)}];
    const dmp = new diff_match_patch();
    const store = {base:{content:base,refCount:1},delta:{content:[],refCount:1,delta:{baseHash:'base',patches:dmp.patch_toText(dmp.patch_make(JSON.stringify(base),JSON.stringify(target)))}}};
    const resolved = JSON.parse(documentOperation(JSON.stringify({operation:'resolveStore',store})));
    expect(JSON.parse(resolved.delta)).toEqual(target);
    expect(() => documentOperation(JSON.stringify({operation:'resolveStore',strict:true,store:{broken:{content:[],refCount:1,delta:{}}}}))).toThrow();
    // Native opaque projection removes delta only from the temporary store.
    const projectedStore = {base:{content:base,refCount:1},delta:{content:target,refCount:1}};
    const document = createSyncDocument({snapshot:{version:18,state:{chats:[],folders:{},contentStore:projectedStore}}});
    const before = projectSyncDocument(document), edited = structuredClone(before);
    expect(JSON.parse(documentOperation(JSON.stringify({operation:'applyEdits',document,before,edited,deltaEntries:['delta'],now})))).toEqual([]);
    edited.contentStore.delta.content[0].text = 'edited';
    const changes = JSON.parse(documentOperation(JSON.stringify({operation:'applyEdits',document,before,edited,deltaEntries:['delta'],now})));
    expect(changes).toContainEqual({op:'remove',path:['snapshot','state','contentStore','delta','delta']});
    const raw = {snapshot:{version:18,state:{chats:[],folders:{},contentStore:store}},v3Sidecar:{}};
    const saved = apply(raw,changes);
    expect(saved.snapshot.state.contentStore.delta).not.toHaveProperty('delta');
    expect(saved.snapshot.state.contentStore.delta.content).toEqual(edited.contentStore.delta.content);
    expect(saved.snapshot.state.contentStore.base).toEqual(store.base);
  });
  it('normalizes Web timestamp undefined fields into remove patches with no missing set values', () => {
    const document = createSyncDocument({snapshot:{version:18,state:{chats:[{id:'flat',title:'old',messages:[]}],contentStore:{},folders:{}}}});
    const before = projectSyncDocument(document),edited = structuredClone(before);
    edited.chats[0].title = 'new';
    const changes = JSON.parse(documentOperation(JSON.stringify({operation:'applyEdits',document,before,edited,now})));
    expect(changes.every((change:any) => change.op !== 'set' || Object.hasOwn(change,'value'))).toBe(true);
    expect(apply(document,changes).snapshot.state.chats[0]).toEqual({id:'flat',title:'new',messages:[],updatedAt:now});
  });
  it('applies synchronized changes without restoring remotely deleted nodes/entries or replacing unchanged raw leaves', () => {
    const document = createSyncDocument({snapshot:fixture('content-entry-wire').snapshot,v3Sidecar:{xV3:'retained'}});
    document.snapshot.state.theme = 'device';
    document.snapshot.state.xHuge = JSON.parse('9007199254740993');
    const received = structuredClone(document.snapshot);
    received.state.theme = 'remote';
    received.state.chats = [];
    received.state.contentStore = {};
    const changes = JSON.parse(documentOperation(JSON.stringify({operation:'syncSnapshot',document,received})));
    expect(changes.some((p:any) => p.path.includes('theme') || p.path.includes('xHuge'))).toBe(false);
    const updated = apply(document.snapshot,changes);
    expect(updated.state.chats).toEqual([]);
    expect(updated.state.contentStore).toEqual({});
    expect(updated.state.theme).toBe('device');
    expect(document.v3Sidecar).toEqual({xV3:'retained'});
    expect(() => documentOperation(JSON.stringify({operation:'syncSnapshot',document,received:{version:19,state:{}}}))).toThrow('different data version');
  });
  it('restores unchanged raw chat values by ID across received insertion while adopting changed metadata and deletions', () => {
    const original = JSON.parse('{"version":18,"state":{"chats":[{"id":"A","title":"old","messages":[],"xHuge":9007199254740993,"xAttrs":{"keep":9007199254740993,"change":"old"}}],"folders":{},"contentStore":{}}}');
    const document = createSyncDocument({snapshot:original});
    const received = structuredClone(original);
    received.state.chats[0].xAttrs.change = 'remote';
    received.state.chats.unshift({id:'B',title:'new',messages:[]});
    const changes = JSON.parse(documentOperation(JSON.stringify({operation:'syncSnapshot',document,received})));
    const restored = changes.map((change:any) => {
      if (!change.rawSources) return change;
      const refs = change.rawSources.map((reference:any) => ({op:'set',path:reference.path,value:reference.sourcePath.reduce((value:any,key:any)=>value[key],original)}));
      return {...change,value:apply(change.value,refs)};
    });
    expect(apply(original,restored)).toEqual(received);
    expect(changes.some((change:any) => change.rawSources?.some((reference:any) => reference.sourcePath.join('.') === 'state.chats.0.xHuge'))).toBe(true);
    const changed = structuredClone(received); changed.state.chats[1].xHuge = 9007199254740996;
    const changedPlan = JSON.parse(documentOperation(JSON.stringify({operation:'syncSnapshot',document,received:changed})));
    expect(changedPlan.flatMap((p:any)=>p.rawSources??[]).some((p:any)=>p.sourcePath.join('.')==='state.chats.0.xHuge')).toBe(false);
    const deleted = structuredClone(received); deleted.state.chats = [deleted.state.chats[0]];
    const deletedPlan = JSON.parse(documentOperation(JSON.stringify({operation:'syncSnapshot',document,received:deleted})));
    expect(deletedPlan.flatMap((p:any)=>p.rawSources??[]).some((p:any)=>p.sourcePath.join('.')==='state.chats.0')).toBe(false);
  });
  it('replaces moved chat positions even when distinct raw numbers collapse to the same JS leaf', () => {
    const snapshot = JSON.parse('{"version":18,"state":{"chats":[{"id":"A","title":"same","messages":[],"xHuge":9007199254740993},{"id":"B","title":"same","messages":[],"xHuge":9007199254740992}],"folders":{},"contentStore":{}}}');
    const document = createSyncDocument({snapshot}), received = structuredClone(snapshot);
    received.state.chats.reverse();
    const changes = JSON.parse(documentOperation(JSON.stringify({operation:'syncSnapshot',document,received})));
    expect(changes.filter((change:any) => change.op === 'set').map((change:any) => change.path)).toEqual([['state','chats',0],['state','chats',1]]);
    expect(changes[0].rawSources).toEqual([{path:[],sourcePath:['state','chats',1]}]);
    expect(changes[1].rawSources).toEqual([{path:[],sourcePath:['state','chats',0]}]);
  });
  it('rejects stale edits and conflicting namespaces without mutating input', () => {
    const document = createSyncDocument({ snapshot: fixture('io-corpus').syncSnapshot });
    const before = projectSyncDocument(document); const saved = structuredClone(document);
    before.chats[0].title = 'stale';
    expect(() => applySyncDocumentEdits(document, before, before)).toThrow('Stale');
    expect(() => createSyncDocument({snapshot: saved.snapshot, v3Sidecar:{chats:[]}})).toThrow('sidecar');
    expect(() => createSyncDocument({v3:{version:18,chats:[]}})).toThrow('version');
    expect(document).toEqual(saved);
  });
});
