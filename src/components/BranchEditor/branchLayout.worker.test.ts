import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkerInput, WorkerOutput } from './branchLayout.worker';

const worker = { onmessage: (_event: MessageEvent<WorkerInput>) => {}, postMessage: vi.fn() };

beforeAll(async () => {
  vi.stubGlobal('self', worker);
  await import('./branchLayout.worker');
});
afterAll(() => vi.unstubAllGlobals());

function layout(parents: Record<string, string | null>, copies = 1) {
  const entries = Array.from({ length: copies }, (_, chatIndex) => ({
    chatIndex,
    chatId: String(chatIndex),
    chatTitle: '',
    activePath: [],
    nodes: Object.fromEntries(Object.entries(parents).map(([id, parentId]) => [id, {
      id, parentId, role: 'user', contentHash: '',
    }])),
  }));
  worker.onmessage(new MessageEvent<WorkerInput>('message', {
    data: { requestId: 1, entries, contentStore: {} },
  }));
  return worker.postMessage.mock.lastCall![0] as WorkerOutput;
}

describe('branch layout worker', () => {
  it('keeps every descendant inside its branch region even when depths differ', () => {
    const { rfNodes, rfEdges } = layout({
      root: null, a: 'root', b: 'root', a1: 'a', a2: 'a',
      a11: 'a1', a12: 'a1', b1: 'b', b2: 'b1', b3: 'b2',
    });
    const byId = new Map(rfNodes.map(node => [node.id, node.position]));
    const aRight = Math.max(...['a', 'a1', 'a2', 'a11', 'a12'].map(id => byId.get(id)!.x + 280));
    const bLeft = Math.min(...['b', 'b1', 'b2', 'b3'].map(id => byId.get(id)!.x));
    expect(bLeft - aRight).toBeGreaterThanOrEqual(100);
    expect(new Set(['b', 'b1', 'b2', 'b3'].map(id => byId.get(id)!.x)).size).toBe(1);
    expect(rfEdges.every(edge => edge.type === 'step')).toBe(true);
  });

  it('preserves rendering of an imported disconnected cycle', () => {
    const { rfNodes, rfEdges } = layout({ root: null, child: 'root', a: 'b', b: 'a' });
    expect(rfNodes).toHaveLength(4);
    expect(rfNodes.map(node => node.id)).toEqual(['root', 'child', 'a', 'b']);
    expect(rfEdges.map(edge => [edge.source, edge.target])).toEqual([['root', 'child'], ['b', 'a'], ['a', 'b']]);
    expect(rfNodes.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
  });

  it('keeps a self-loop and every node in the imported graph', () => {
    const { rfNodes, rfEdges } = layout({ root: null, child: 'root', loop: 'loop' });
    expect(rfNodes.map(node => node.id)).toEqual(['root', 'child', 'loop']);
    expect(rfEdges.map(edge => [edge.source, edge.target])).toEqual([['root', 'child'], ['loop', 'loop']]);
    expect(rfNodes.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
  });

  it('preserves the order and edges of multiple disconnected components', () => {
    const { rfNodes, rfEdges } = layout({ root: null, child: 'root', a: 'b', b: 'a', c: 'd', d: 'c' });
    expect(rfNodes.map(node => node.id)).toEqual(['root', 'child', 'a', 'b', 'c', 'd']);
    expect(rfEdges.map(edge => [edge.source, edge.target])).toEqual([
      ['root', 'child'], ['b', 'a'], ['a', 'b'], ['d', 'c'], ['c', 'd'],
    ]);
    expect(rfNodes.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
  });

  it('places an unbranched conversation in one vertical column', () => {
    const { rfNodes } = layout({ root: null, a: 'root', b: 'a', c: 'b' });
    expect(rfNodes.map(node => node.position.x)).toEqual([0, 0, 0, 0]);
    expect(rfNodes.map(node => node.position.y)).toEqual([0, 180, 360, 540]);
  });

  it('keeps separate conversations apart and treats missing parents as roots', () => {
    const { rfNodes, rfEdges } = layout({ root: 'missing', a: 'root', b: 'root' }, 2);
    const first = rfNodes.filter(node => node.data.chatIndex === 0);
    const second = rfNodes.filter(node => node.data.chatIndex === 1);
    const firstRight = Math.max(...first.map(node => node.position.x + 280));
    expect(Math.min(...second.map(node => node.position.x)) - firstRight).toBe(120);
    expect(rfEdges.some(edge => edge.source === 'missing')).toBe(false);
  });
});
