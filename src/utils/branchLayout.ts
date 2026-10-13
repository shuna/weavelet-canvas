import dagre from '@dagrejs/dagre';

const NODE_W = 280;
const NODE_H = 80;
const TREE_GAP = 120;
const BRANCH_GAP = 100;
const LEVEL_GAP = 100;

const CONVERSATION_COLORS = [
  { hue: 210, stroke: '#3b82f6' },
  { hue: 150, stroke: '#14b8a6' },
  { hue: 30, stroke: '#f97316' },
  { hue: 300, stroke: '#a855f7' },
];

interface ContentEntry {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  refCount: number;
}

type ContentStoreData = Record<string, ContentEntry>;

interface SerializedNode {
  id: string;
  parentId: string | null;
  role: string;
  contentHash: string;
  label?: string;
}

interface SerializedEntry {
  chatIndex: number;
  chatId: string;
  chatTitle: string;
  nodes: Record<string, SerializedNode>;
  activePath: string[];
}

export interface WorkerInput {
  requestId: number;
  entries: SerializedEntry[];
  contentStore: ContentStoreData;
}

export interface PlainNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    nodeId: string;
    role: string;
    contentPreview: string;
    label?: string;
    isActive: boolean;
    chatIndex: number;
    colorHue: number;
    conversationColor: string;
  };
}

export interface PlainEdge {
  data: { chatIndex: number };
  id: string;
  source: string;
  target: string;
  type: string;
  style: { stroke: string; strokeWidth: number };
}

export interface WorkerOutput {
  requestId: number;
  rfNodes: PlainNode[];
  rfEdges: PlainEdge[];
}

function resolveContentPreview(
  store: ContentStoreData,
  hash: string
): string {
  const entry = store[hash];
  if (!entry) return '';
  const texts: string[] = [];
  for (const c of entry.content) {
    if (c.text !== undefined) texts.push(c.text);
  }
  const joined = texts.join(' ');
  return joined.length > 80 ? joined.slice(0, 80) + '...' : joined;
}

function layoutSingleTree(
  nodes: Record<string, SerializedNode>,
  activePath: string[],
  xOffset: number,
  chatIndex: number,
  colorIdx: number,
  contentStore: ContentStoreData
): { rfNodes: PlainNode[]; rfEdges: PlainEdge[]; maxX: number } {
  const nodeValues = Object.values(nodes);
  if (nodeValues.length === 0) {
    return { rfNodes: [], rfEdges: [], maxX: xOffset };
  }

  const children = new Map<string, SerializedNode[]>();
  const roots: SerializedNode[] = [];
  for (const node of nodeValues) {
    if (node.parentId && nodes[node.parentId]) {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    } else {
      roots.push(node);
    }
  }

  // Reserve each subtree's full width so descendants never enter a sibling branch.
  const traversal: SerializedNode[] = [];
  const pending = [...roots];
  while (pending.length > 0) {
    const node = pending.pop()!;
    traversal.push(node);
    pending.push(...(children.get(node.id) ?? []));
  }
  const widths = new Map<string, number>();
  for (let i = traversal.length - 1; i >= 0; i--) {
    const node = traversal[i];
    const childNodes = children.get(node.id) ?? [];
    const childWidth = childNodes.reduce((sum, child) => sum + widths.get(child.id)!, 0);
    widths.set(node.id, Math.max(NODE_W, childWidth + Math.max(0, childNodes.length - 1) * BRANCH_GAP));
  }

  const positions = new Map<string, { x: number; y: number }>();
  const placements: Array<{ node: SerializedNode; left: number; depth: number }> = [];
  let rootLeft = 0;
  for (const node of roots) {
    placements.push({ node, left: rootLeft, depth: 0 });
    rootLeft += widths.get(node.id)! + BRANCH_GAP;
  }
  while (placements.length > 0) {
    const { node, left, depth } = placements.pop()!;
    const width = widths.get(node.id)!;
    positions.set(node.id, {
      x: left + (width - NODE_W) / 2,
      y: depth * (NODE_H + LEVEL_GAP),
    });
    let childLeft = left;
    for (const child of children.get(node.id) ?? []) {
      placements.push({ node: child, left: childLeft, depth: depth + 1 });
      childLeft += widths.get(child.id)! + BRANCH_GAP;
    }
  }

  // Imported graphs can contain disconnected cycles; preserve their previous layout.
  if (positions.size !== nodeValues.length) {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: LEVEL_GAP });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const node of nodeValues) {
      graph.setNode(node.id, { width: NODE_W, height: NODE_H });
    }
    for (const node of nodeValues) {
      if (node.parentId && nodes[node.parentId]) graph.setEdge(node.parentId, node.id);
    }
    dagre.layout(graph);
    for (const node of nodeValues) {
      const position = graph.node(node.id);
      positions.set(node.id, { x: position.x - NODE_W / 2, y: position.y - NODE_H / 2 });
    }
  }

  const activeSet = new Set(activePath);
  const color = CONVERSATION_COLORS[colorIdx % CONVERSATION_COLORS.length];
  let maxX = xOffset;

  const rfNodes: PlainNode[] = nodeValues.map((node) => {
    const pos = positions.get(node.id)!;
    const x = pos.x + xOffset;
    const y = pos.y;
    if (x + NODE_W > maxX) maxX = x + NODE_W;

    return {
      id: node.id,
      type: 'messageNode',
      position: { x, y },
      data: {
        nodeId: node.id,
        role: node.role,
        contentPreview: resolveContentPreview(contentStore, node.contentHash),
        label: node.label,
        isActive: activeSet.has(node.id),
        chatIndex,
        colorHue: color.hue,
        conversationColor: color.stroke,
      },
    };
  });

  const rfEdges: PlainEdge[] = nodeValues
    .filter((n) => n.parentId && nodes[n.parentId])
    .map((n) => ({
      id: `${n.parentId}-${n.id}`,
      data: { chatIndex },
      type: 'step',
      source: n.parentId!,
      target: n.id,
      style: activeSet.has(n.id)
        ? { stroke: color.stroke, strokeWidth: 2 }
        : { stroke: '#6b7280', strokeWidth: 1 },
    }));

  return { rfNodes, rfEdges, maxX };
}

export function layoutBranchEntries(input: WorkerInput): WorkerOutput {
  const { requestId, entries, contentStore } = input;

  const allNodes: PlainNode[] = [];
  const allEdges: PlainEdge[] = [];
  let xOffset = 0;

  entries.forEach((entry, idx) => {
    const { rfNodes, rfEdges, maxX } = layoutSingleTree(
      entry.nodes,
      entry.activePath,
      xOffset,
      entry.chatIndex,
      idx,
      contentStore
    );
    allNodes.push(...rfNodes);
    allEdges.push(...rfEdges);
    xOffset = maxX + TREE_GAP;
  });

  const result: WorkerOutput = { requestId, rfNodes: allNodes, rfEdges: allEdges };
  return result;
}
