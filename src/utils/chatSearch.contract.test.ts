import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { chatSearch } from '../../shared/google-sync/search';
import { grepChats, matchesChatHistoryFilter } from './chatSearch';
import { createGrepSlice } from '../store/grep-slice';
import { addContentDelta } from './contentStore';

const fixture = () => ({
  chats: [
    { id: 'tree', title: 'Other title', folder: 'child', messages: [], branchTree: { rootId: 'root', activePath: ['root', 'a'], nodes: {
      root: { id: 'root', parentId: null, role: 'user', contentHash: 'root' },
      b: { id: 'b', parentId: 'root', role: 'assistant', contentHash: 'b', label: 'Needle label', starred: true },
      a: { id: 'a', parentId: 'root', role: 'assistant', contentHash: 'a', pinned: true },
      orphan: { id: 'orphan', parentId: 'missing', role: 'assistant', contentHash: 'orphan', starred: true, pinned: true },
    } } },
    { id: 'flat', title: 'Needle title', messages: [{ role: 'user', content: [{ type: 'text', text: 'Needle flat' }, { type: 'reasoning', text: 'Reasoning only' }, { type: 'tool_result', tool_call_id: 'tool', content: 'Tool only' }] }] },
    { id: 'selected', title: 'Unmatched', messages: [] },
  ],
  folders: { parent: { id: 'parent', name: 'Work', order: 0, expanded: false }, child: { id: 'child', name: 'Nested', parentId: 'parent', order: 1, expanded: false } },
  contentStore: Object.fromEntries(Object.entries({ root: 'Needle root', b: 'No body match', a: 'Needle active', orphan: 'Needle orphan' })
    .map(([key, text]) => [key, { content: [{ type: 'text', text }], refCount: 1 }])),
});
const search = (source: any, query: string, mode: string, extra = {}) => JSON.parse(chatSearch(JSON.stringify({ ...source, query, mode, ...extra })));
describe('shared actual Web conversation search', () => {
  it('keeps library title/folder-ancestor/current-chat rules and source order', () => {
    const source = fixture();
    expect(search(source, 'needle', 'library').map((result: any) => result.chatId)).toEqual(['flat']);
    expect(search(source, 'WORK', 'library').map((result: any) => result.chatId)).toEqual(['tree']);
    expect(search(source, 'needle', 'library', { currentChatID: 'selected' }).map((result: any) => result.chatId)).toEqual(['flat', 'selected']);
    expect(matchesChatHistoryFilter(' needle ', source.chats[1] as any, source.folders)).toBe(false);
    expect(search(source, '', 'library').map((result: any) => result.chatId)).toEqual(['tree', 'flat', 'selected']);
  });
  it('uses actual DFS order, body-before-label match, pinned orphan and active-path scope', () => {
    const source = fixture();
    const all = search(source, 'NEEDLE', 'nodes');
    expect(all.map((result: any) => result.nodeId)).toEqual(['root', 'b', 'a', 'orphan']);
    expect(all.map((result: any) => result.matchType)).toEqual(['content', 'label', 'content', 'content']);
    expect(all[1]).toMatchObject({ label: 'Needle label', starred: true, snippet: 'No body match', isOnActivePath: false });
    expect(all[3]).toMatchObject({ pinned: true, starred: true, chatId: 'tree' });
    expect(search(source, 'needle', 'nodes', { scope: 'activePath' }).map((result: any) => result.nodeId)).toEqual(['root', 'a']);
  });
  it('uses native current viewing path without rewriting the saved document', () => {
    const source = fixture(), before = structuredClone(source);
    expect(search(source, 'needle', 'nodes', {scope:'activePath',currentChatID:'tree',currentPath:['root','b']}).map((result:any) => result.nodeId)).toEqual(['root','b']);
    expect(source).toEqual(before);
  });
  it('supports star-only empty query, exact branch whitespace and chat identity restriction', () => {
    const source = fixture();
    expect(search(source, '', 'nodes', { starredOnly: true }).map((result: any) => result.nodeId)).toEqual(['b', 'orphan']);
    expect(search(source, '', 'nodes')).toEqual([]);
    expect(search(source, ' needle ', 'nodes')).toEqual([]);
    expect(search(source, 'needle', 'nodes', { chatID: 'flat' })).toEqual([]);
  });
  it('extracts real grep caller rules, trimming query and preserving flat legacy navigation', () => {
    const source = fixture(), matches = search(source, '  needle  ', 'grep');
    expect(matches.map((result: any) => [result.chatId, result.nodeId, result.resultId])).toEqual([
      ['tree', 'root', 'root'], ['tree', 'b', 'b'], ['tree', 'a', 'a'], ['tree', 'orphan', 'orphan'], ['flat', null, 'legacy-0'],
    ]);
    expect(search(source, 'reasoning only', 'grep')).toEqual([]);
    expect(search(source, 'tool only', 'grep')).toEqual([]);
    let state: any = { ...source, grepQuery: '  needle  ' };
    const set = (partial: any) => { state = { ...state, ...partial }; };
    Object.assign(state, createGrepSlice(set as any, () => state));
    state.grepQuery = '  needle  '; state.executeGrep();
    expect(state.grepResults).toEqual(grepChats(source.chats as any, source.contentStore as any, 'needle'));
    expect(state.isGrepSearching).toBe(false);
  });
  it('resolves existing shared delta content without rewriting entries or source metadata', () => {
    const source: any = fixture();
    source.contentStore.base = { content: [{ type: 'text', text: 'Long prefix '.repeat(200) }], refCount: 2 };
    const hash = addContentDelta(source.contentStore, [{ type: 'text', text: 'Long prefix '.repeat(200) + 'needle delta' }], 'base');
    expect(source.contentStore[hash].delta).toBeDefined();
    source.chats[0].branchTree.nodes.a.contentHash = hash;
    source.xRoot = { keep: 'opaque' }; source.contentStore[hash].xEntry = { keep: 'entry' };
    const before = structuredClone(source);
    expect(search(source, 'needle delta', 'nodes').map((result: any) => result.nodeId)).toEqual(['a']);
    expect(source).toEqual(before);
  });
  it('uses previous hand-defined content-entry wire delta fixture through actual search', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/content-entry-wire.json', import.meta.url), 'utf8'));
    const source = fixture.snapshot.state;
    const before = structuredClone(source);
    const matches = search(source, 'FAKE TEST body', 'nodes');
    expect(matches.map((result: any) => result.nodeId)).toEqual(['left', 'right', 'delta']);
    expect(source).toEqual(before);
  });
  it('encodes only isolated snippet surrogates as the replacement Web display glyph', () => {
    const source: any = fixture();
    source.contentStore.b.content = [{ type: 'text', text: 'a'.repeat(79) + '🙂' }];
    const before = structuredClone(source);
    const result = search(source, 'label', 'nodes')[0];
    expect(result.snippet).toBe('a'.repeat(79) + '\uFFFD...');
    source.contentStore.b.content = [{ type: 'text', text: 'a'.repeat(78) + '🙂' }];
    expect(search(source, 'label', 'nodes')[0].snippet).toBe('a'.repeat(78) + '🙂');
    expect(before.contentStore.b.content[0].text).toBe('a'.repeat(79) + '🙂');
  });
});
