import useStore from '@store/store';
import { BranchTree, isImageContent, isReasoningContent, isTextContent } from '@type/chat';
import { resolveContent } from '@utils/contentStore';
import Avatar from './Avatar';
import ContentBody from './View/ContentBody';
import ContentAttachments from './View/ContentAttachments';
import CollapsibleReasoning from './View/CollapsibleReasoning';

// Preview only: no editors, actions, navigation markers or branch mutations.
export default function BranchSwipePreview({ tree, path, startIndex, chatIndex }: {
  tree: BranchTree; path: string[]; startIndex: number; chatIndex: number;
}) {
  const state = useStore.getState();
  const chat = state.chats?.[chatIndex];
  const collapsed = state.collapsedNodeMaps[String(chatIndex)] ?? chat?.collapsedNodes ?? {};
  const omitted = state.omittedNodeMaps[String(chatIndex)] ?? chat?.omittedNodes ?? {};
  const protectedNodes = state.protectedNodeMaps[String(chatIndex)] ?? chat?.protectedNodes ?? {};
  const expanded = window.matchMedia('(min-width: 768px)').matches && !state.hideSideMenu;
  const maxWidth = expanded ? 'md:max-w-3xl lg:max-w-3xl xl:max-w-4xl' : 'md:max-w-4xl lg:max-w-4xl xl:max-w-5xl';
  return <>{path.slice(startIndex).map((id, offset) => {
    const node = tree.nodes[id];
    const content = resolveContent(state.contentStore, node.contentHash);
    const text = content.find(isTextContent)?.text ?? '';
    const reasoning = content.filter(isReasoningContent).map(part => part.text).join('');
    return <div key={id} className={`w-full border-b border-black/10 dark:border-gray-900/50 text-gray-800 dark:text-gray-100 ${(startIndex + offset) % 2 ? 'bg-gray-50 dark:bg-gray-650' : 'dark:bg-gray-800'}${omitted[id] ? ' opacity-50' : ''}${protectedNodes[id] ? ' ring-2 ring-inset ring-blue-400/30 dark:ring-blue-500/25' : ''}`}>
      <div className={`text-base gap-1.5 md:gap-2 m-auto px-7 py-6 md:py-8 flex flex-col ${maxWidth}`}>
        <div className='flex items-center gap-2.5'><Avatar role={node.role} /></div>
        <div className='rounded-2xl bg-white/60 px-4 pt-2.5 pb-2 shadow-sm ring-1 ring-black/5 dark:bg-gray-900/20 dark:ring-white/10 md:px-5 md:pt-3 md:pb-2.5'>
          {collapsed[id] ? <div className='h-[4.5rem] overflow-hidden text-sm leading-6 whitespace-pre-wrap break-words line-clamp-3'>{(text.replace(/\s+/g, ' ').trim() || `${node.role} message`).slice(0, 280)}</div> : <>
            {reasoning && <CollapsibleReasoning reasoning={reasoning} isGenerating={false} visible={false} />}
            <div className='min-h-[5.25rem]'><ContentBody currentTextContent={text} markdownMode={state.markdownMode} streamingMarkdownPolicy={state.streamingMarkdownPolicy} inlineLatex={state.inlineLatex} isGeneratingMessage={false} nodeId={id} /></div>
            <ContentAttachments images={content.slice(1).filter(isImageContent)} />
            <div className='mt-2.5 min-h-[2.75rem]' />
          </>}
        </div>
      </div>
    </div>;
  })}</>;
}
