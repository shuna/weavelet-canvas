import { findTextMatches } from './chatFind';

const MARK_CLASS = 'chat-find-highlight';
const ACTIVE_CLASS = 'chat-find-highlight-active';
export type ChatFindMatch = { marks: HTMLElement[]; range: Range };

export function clearChatFind(root: HTMLElement): void {
  for (const mark of root.querySelectorAll(`mark.${MARK_CLASS}`)) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(root.ownerDocument.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  }
}

export function highlightChatFind(root: HTMLElement, query: string): ChatFindMatch[] {
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
    node.parentNode!.replaceChild(fragment, node);
    for (const match of local) {
      match.range.setStart(match.marks[0].firstChild!, 0);
      const last = match.marks[match.marks.length - 1].lastChild!;
      match.range.setEnd(last, last.textContent!.length);
      matches.push(match);
    }
  }
  return matches;
}

export function selectChatFindMatch(matches: readonly ChatFindMatch[], index: number): ChatFindMatch | undefined {
  for (const match of matches) for (const mark of match.marks) mark.classList.remove(ACTIVE_CLASS);
  const selected = matches[index];
  selected?.marks.forEach(mark => mark.classList.add(ACTIVE_CLASS));
  return selected;
}
