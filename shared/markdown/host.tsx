import React from 'react';
import initialState from '../google-sync/importDefaults.generated.json';
import { createRoot } from 'react-dom/client';
import ContentBody from '../../src/components/Chat/ChatContent/Message/View/ContentBody';
import type { StreamingMarkdownPolicy } from '../../src/types/chat';
export interface MarkdownUpdate {
  content: string; inlineLatex?: boolean; markdownMode?: boolean;
  policy?: StreamingMarkdownPolicy; isGenerating: boolean;
  fontSize: number; dark: boolean; isDesktopLike: boolean; saveData: boolean;
}
const post = (message: unknown) => (window as any).webkit?.messageHandlers?.markdown?.postMessage(message);
const element = document.getElementById('root')!;
const root = createRoot(element);
const onCopy = async (text: string) => { post({ type: 'copy', text }); };
(window as any).weaveletMarkdown = {
  update(value: MarkdownUpdate) {
    document.documentElement.classList.toggle('dark', value.dark);
    document.documentElement.style.fontSize = `${value.fontSize}px`;
    root.render(<ContentBody currentTextContent={value.content} inlineLatex={value.inlineLatex ?? initialState.values.inlineLatex}
      markdownMode={value.markdownMode ?? initialState.values.markdownMode} streamingMarkdownPolicy={value.policy ?? initialState.values.streamingMarkdownPolicy as StreamingMarkdownPolicy}
      isGeneratingMessage={value.isGenerating} onCopy={onCopy}
      environment={{ isDesktopLike: value.isDesktopLike, saveData: value.saveData }} />);
  },
};
// ResizeObserver also covers deferred Markdown, fonts and table layout.
let height = -1;
new ResizeObserver(() => {
  const value = Math.ceil(element.getBoundingClientRect().height);
  if (value !== height) { height = value; post({ type: 'height', value }); }
}).observe(element);
document.addEventListener('click', event => {
  const anchor = (event.target as Element).closest?.('a');
  if (!anchor) return;
  event.preventDefault();
  const url = anchor.getAttribute('href');
  if (url) post({ type: 'link', url }); // href already passed ReactMarkdown's URL transformer.
});
