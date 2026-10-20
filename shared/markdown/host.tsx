import React from 'react';
import initialState from '../google-sync/importDefaults.generated.json';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { findTextMatches } from '../../src/utils/chatFind';
import ContentBody from '../../src/components/Chat/ChatContent/Message/View/ContentBody';
import type { StreamingMarkdownPolicy } from '../../src/types/chat';
import { clearChatFind, highlightChatFind, selectChatFindMatch, type ChatFindMatch } from '../../src/utils/chatFindDom';
export interface MarkdownUpdate {
  content: string; inlineLatex?: boolean; markdownMode?: boolean;
  policy?: StreamingMarkdownPolicy; isGenerating: boolean;
  fontSize: number; dark: boolean; isDesktopLike: boolean; saveData: boolean;
}
const post = (message: unknown) => (window as any).webkit?.messageHandlers?.markdown?.postMessage(message);
const element = document.getElementById('root')!;
const root = createRoot(element);
const onCopy = async (text: string) => { post({ type: 'copy', text }); };
type FindRequest = { query: string; index: number; requestID: string };
let findRequest: FindRequest | null = null;
let findMatches: ChatFindMatch[] = [];
const observeSearchContent = () => searchObserver.observe(element, { childList: true, subtree: true, characterData: true });
const findResult = () => {
  const selected = findRequest ? selectChatFindMatch(findMatches, findRequest.index) : undefined;
  const rect = selected?.range.getBoundingClientRect();
  return { requestID: findRequest?.requestID ?? '', count: findMatches.length,
    selectedIndex: selected ? findRequest!.index : null,
    rect: rect ? { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height } : null };
};
const publishFind = () => {
  const result = findResult();
  if (findRequest) post({ type: 'find', ...result });
  return result;
};
const refreshFind = () => {
  searchObserver.disconnect();
  try {
    findMatches = highlightChatFind(element, findRequest?.query ?? '');
    return publishFind();
  } finally { observeSearchContent(); }
};
const searchObserver = new MutationObserver(() => {
  if (findRequest) refreshFind();
});
observeSearchContent();
(window as any).weaveletMarkdown = {
  async index(entries: { id: string; text: string; rendered: boolean; inlineLatex: boolean }[], query: string) {
    const Renderer = (await import('../../src/components/Chat/ChatContent/Message/View/MarkdownRenderer')).default;
    // One temporary DOM indexes unmounted rows without creating a WebView for every message.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const indexRoot = createRoot(container);
    try {
      return entries.map(entry => {
        if (!entry.rendered) {
          const ranges = findTextMatches(entry.text, query);
          return { id: entry.id, count: ranges.length, ranges };
        }
        flushSync(() => indexRoot.render(<div key={entry.id}><Renderer content={entry.text} inlineLatex={entry.inlineLatex} onCopy={async () => {}} /></div>));
        const element = container.firstElementChild as HTMLElement;
        const count = highlightChatFind(element, query).length;
        clearChatFind(element);
        return { id: entry.id, count, ranges: [] };
      });
    } finally {
      for (const child of Array.from(container.children)) clearChatFind(child as HTMLElement);
      flushSync(() => indexRoot.unmount());
      container.remove();
    }
  },
  find(value: FindRequest) {
    findRequest = value.query.trim() ? value : null;
    return refreshFind();
  },
  update(value: MarkdownUpdate) {
    searchObserver.disconnect();
    clearChatFind(element);
    findMatches = [];
    observeSearchContent();
    document.documentElement.classList.toggle('dark', value.dark);
    document.documentElement.style.fontSize = `${value.fontSize}px`;
    root.render(<MarkdownContent value={value} />);
  },
};
function MarkdownContent({ value }: { value: MarkdownUpdate }) {
  // Props-only updates can leave the DOM unchanged after update cleared the marks.
  React.useLayoutEffect(() => { if (findRequest) refreshFind(); });
  return <ContentBody currentTextContent={value.content} inlineLatex={value.inlineLatex ?? initialState.values.inlineLatex}
      markdownMode={value.markdownMode ?? initialState.values.markdownMode} streamingMarkdownPolicy={value.policy ?? initialState.values.streamingMarkdownPolicy as StreamingMarkdownPolicy}
      isGeneratingMessage={value.isGenerating} onCopy={onCopy}
      environment={{ isDesktopLike: value.isDesktopLike, saveData: value.saveData }} />;
}
// ResizeObserver also covers deferred Markdown, fonts and table layout.
let height = -1;
new ResizeObserver(() => {
  const value = Math.ceil(element.getBoundingClientRect().height);
  if (value !== height) { height = value; post({ type: 'height', value }); }
  publishFind();
}).observe(element);
document.addEventListener('click', event => {
  const anchor = (event.target as Element).closest?.('a');
  if (!anchor) return;
  event.preventDefault();
  const url = anchor.getAttribute('href');
  if (url) post({ type: 'link', url }); // href already passed ReactMarkdown's URL transformer.
});
