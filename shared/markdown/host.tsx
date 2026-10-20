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
export interface ChatImagePart {
  kind: 'plain' | 'text' | 'reasoning' | 'image' | 'toolCall' | 'toolResult';
  text?: string; name?: string; id?: string; detail?: string;
}
export interface ChatImageMessage { role: string; parts: ChatImagePart[]; }
export interface ChatImageUpdate {
  title: string; messages: ChatImageMessage[]; inlineLatex?: boolean; markdownMode?: boolean;
  policy?: StreamingMarkdownPolicy; dark: boolean; isDesktopLike: boolean; saveData: boolean;
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
  async capture(value: ChatImageUpdate) {
    document.documentElement.classList.toggle('dark', value.dark);
    const renderer = (await import('../../src/components/Chat/ChatContent/Message/View/MarkdownRenderer')).default;
    flushSync(() => root.render(<ChatImageContent value={value} renderer={renderer} />));
    await waitForCaptureLayout();
    const rect = element.getBoundingClientRect();
    return { width: Math.ceil(rect.width), height: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, rect.bottom)) };
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
const roleName = (role: string) => role === 'user' ? 'ユーザー' : role === 'system' ? 'システム' : 'アシスタント';
const chatImageStyle = `.chat-image{color-scheme:light}.dark .chat-image{color-scheme:dark}.chat-image pre,.chat-image code{white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:break-word}.chat-image .overflow-auto{overflow:visible!important}.chat-image button{display:none}.chat-image{box-sizing:border-box;width:100%;padding:32px;color:CanvasText;background:Canvas}.chat-image h1{margin:0 0 28px;font-size:1.5rem}.chat-image-message{margin:0 0 20px;padding:18px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:12px}.chat-image-message>h2{margin:0 0 12px;font-size:1rem}.chat-image-user{background:color-mix(in srgb,#c74444 10%,Canvas)}.chat-image-system{background:color-mix(in srgb,#3178c6 10%,Canvas)}.chat-image-assistant{background:color-mix(in srgb,#0ca37f 10%,Canvas)}.chat-image-part{margin-top:14px}.chat-image-part h3{margin:0 0 8px;font-size:.95rem}.chat-image-part p{margin:0 0 8px}.chat-image-part pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.chat-image-part img{display:block;max-width:100%;max-height:768px;object-fit:contain}`;
type CaptureRenderer = typeof import('../../src/components/Chat/ChatContent/Message/View/MarkdownRenderer').default;
function ChatImageContent({ value, renderer }: { value: ChatImageUpdate; renderer: CaptureRenderer }) {
  const markdown = value.markdownMode ?? initialState.values.markdownMode;
  const policy = value.policy ?? initialState.values.streamingMarkdownPolicy as StreamingMarkdownPolicy;
  return <main className="chat-image" aria-label={value.title || 'チャット'}><style>{chatImageStyle}</style>
    <h1>{value.title || 'チャット'}</h1>
    {value.messages.map((message, messageIndex) => <section className={`chat-image-message chat-image-${message.role}`} key={messageIndex}>
      <h2>{roleName(message.role)}</h2>
      {message.parts.map((part, partIndex) => <ChatImagePartView key={partIndex} part={part} markdown={markdown}
        inlineLatex={value.inlineLatex ?? initialState.values.inlineLatex} policy={policy} renderer={renderer}
        environment={{ isDesktopLike: value.isDesktopLike, saveData: value.saveData }} />)}
    </section>)}
  </main>;
}
function ChatImagePartView({ part, markdown, inlineLatex, policy, environment, renderer }: { renderer: CaptureRenderer; part: ChatImagePart; markdown: boolean; inlineLatex: boolean; policy: StreamingMarkdownPolicy; environment: { isDesktopLike: boolean; saveData: boolean } }) {
  switch (part.kind) {
    case 'plain': return <p style={{ whiteSpace: 'pre-wrap' }}>{part.text ?? ''}</p>;
    case 'text': return <ContentBody renderer={renderer} currentTextContent={part.text ?? ''} markdownMode={markdown} inlineLatex={inlineLatex}
      streamingMarkdownPolicy={policy} isGeneratingMessage={false} onCopy={async () => {}} environment={environment} />;
    case 'reasoning': return <section className="chat-image-part"><h3>推論</h3><ContentBody renderer={renderer} currentTextContent={part.text ?? ''} markdownMode={markdown}
      inlineLatex={inlineLatex} streamingMarkdownPolicy={policy} isGeneratingMessage={false} onCopy={async () => {}} environment={environment} /></section>;
    case 'image': return <section className="chat-image-part"><h3>添付画像{part.detail ? `（${part.detail}）` : ''}</h3>{part.text ? <img src={part.text} alt="添付画像" /> : <p>画像を読み込めませんでした。</p>}</section>;
    case 'toolCall': return <section className="chat-image-part"><h3>ツール呼び出し: {part.name ?? ''}</h3><p>ID: {part.id ?? ''}</p><pre>{part.text ?? ''}</pre></section>;
    case 'toolResult': return <section className="chat-image-part"><h3>ツール結果</h3><p>呼び出しID: {part.id ?? ''}</p><pre>{part.text ?? ''}</pre></section>;
  }
}
async function waitForCaptureLayout() {
  let timeout: number | undefined;
  try {
    await Promise.race([
      Promise.all([document.fonts.ready, ...Array.from(element.querySelectorAll('img')).map(image => image.decode())]),
      new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('画像やフォントを読み込めませんでした。')), 10_000); }),
    ]);
    // Layout is synchronous after the final DOM, fonts and image decoding are ready.
    const clipped = [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))].some(node =>
      node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1 &&
      (node === element || ['auto','scroll','hidden','clip'].includes(getComputedStyle(node).overflowX)));
    if (clipped) throw new Error('本文が画像の横幅を超えています。');
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
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
