import { findTextMatches } from './chatFind';

const MARK_CLASS = 'chat-find-highlight';
const ACTIVE_CLASS = 'chat-find-highlight-active';
export type ChatFindMatch = { marks: HTMLElement[]; range: Range };

type HighlightedText = { node: Text; text: string; pieces: Node[] };
type HighlightSession = { targets: HighlightedText[]; observer: MutationObserver };
const sessions = new WeakMap<HTMLElement, HighlightSession>();

export function clearChatFind(root: HTMLElement): void {
  const session = sessions.get(root);
  if (!session) return;
  const updated = new Set(session.observer.takeRecords().filter(record => record.type === 'characterData').map(record => record.target));
  session.observer.disconnect();
  sessions.delete(root);
  for (const { node, text, pieces } of session.targets) {
    // Keep React's Text identity and never overwrite a renderer's newer value.
    if (node.parentNode && !updated.has(node) && node.data === '') node.data = text;
    for (const piece of pieces) piece.parentNode?.removeChild(piece);
  }
}

export function highlightChatFind(root: HTMLElement, query: string, onInvalidate?: () => void): ChatFindMatch[] {
  clearChatFind(root);
  if (!query.trim()) return [];
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('[data-chat-find-bar], textarea, input, [contenteditable]:not([contenteditable="false"])')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const targets: Text[] = [];
  while (walker.nextNode()) targets.push(walker.currentNode as Text);
  const matches: ChatFindMatch[] = [];
  const session: HighlightSession = {
    targets: [],
    observer: new MutationObserver(records => {
      const relevant = records.filter(record => {
        const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target as Element : record.target.parentElement;
        return !element?.closest('[data-chat-find-bar], textarea, input, [contenteditable]:not([contenteditable="false"])');
      });
      if (!relevant.length) return;
      // Preserve mutation records so clear can distinguish a renderer's empty text from ours.
      for (const record of relevant) if (record.type === 'characterData') {
        const target = session.targets.find(entry => entry.node === record.target);
        if (target) target.text = target.node.data;
      }
      clearChatFind(root);
      onInvalidate?.();
    }),
  };
  for (const node of targets) {
    const text = node.data;
    const positions = findTextMatches(text, query);
    if (!positions.length) continue;
    const local = positions.map(() => ({ marks: [] as HTMLElement[], range: document.createRange() }));
    const events = new Map<number, { starts: number[]; ends: number[] }>();
    for (const [index, position] of positions.entries()) {
      for (const [offset, kind] of [[position.start, 'starts'], [position.end, 'ends']] as const) {
        if (!events.has(offset)) events.set(offset, { starts: [], ends: [] });
        events.get(offset)![kind].push(index);
      }
    }
    const boundaries = [...new Set([0, text.length, ...events.keys()])].sort((a, b) => a - b);
    const active = new Set<number>();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < boundaries.length - 1; index++) {
      const start = boundaries[index], end = boundaries[index + 1];
      const event = events.get(start);
      event?.ends.forEach(match => active.delete(match));
      event?.starts.forEach(match => active.add(match));
      const part = document.createTextNode(text.slice(start, end));
      if (active.size) {
        // Shared segments represent overlapping matches without duplicating the source text.
        const mark = document.createElement('mark');
        mark.className = MARK_CLASS;
        mark.appendChild(part);
        fragment.appendChild(mark);
        active.forEach(match => local[match].marks.push(mark));
      } else fragment.appendChild(part);
    }
    const pieces = Array.from(fragment.childNodes);
    node.parentNode!.insertBefore(fragment, node.nextSibling);
    node.data = '';
    session.targets.push({ node, text, pieces });
    for (const match of local) {
      match.range.setStart(match.marks[0].firstChild!, 0);
      const last = match.marks[match.marks.length - 1].lastChild!;
      match.range.setEnd(last, last.textContent!.length);
      matches.push(match);
    }
  }
  if (session.targets.length || onInvalidate) {
    sessions.set(root, session);
    session.observer.observe(root, { childList: true, characterData: true, subtree: true });
  }
  return matches;
}

export function selectChatFindMatch(matches: readonly ChatFindMatch[], index: number): ChatFindMatch | undefined {
  for (const match of matches) for (const mark of match.marks) mark.classList.remove(ACTIVE_CLASS);
  const selected = matches[index];
  selected?.marks.forEach(mark => mark.classList.add(ACTIVE_CLASS));
  return selected;
}
