import React, { memo, useEffect, useState } from 'react';
import useStore from '@store/store';
import useSubmit from '@hooks/useSubmit';
import { confirmChatModelFavorite } from '@utils/chatModelResolution';
import {
  ContentInterface,
  ImageContentInterface,
  Role,
  isImageContent,
  isTextContent,
} from '@type/chat';
import { resolveRegenerateTarget } from '@utils/branchUtils';
import { useEditViewLogic } from './useEditViewLogic';
import { MessageEditForm } from './EditView';
import ContentActions from './ContentActions';
import ContentAttachments from './ContentAttachments';
import ContentBody from './ContentBody';
import EvaluationPanel from './EvaluationPanel';
import type { TabId } from './EvaluationModal';
import PopupModal from '@components/PopupModal';
import { useTranslation } from 'react-i18next';
import { useStreamingText } from '@hooks/useStreamingText';
import { useStreamingReasoning } from '@hooks/useStreamingReasoning';
import { isReasoningContent } from '@type/chat';
import CollapsibleReasoning from './CollapsibleReasoning';

const UnifiedMessageView = memo(
  ({
    role,
    content,
    setIsEdit,
    messageIndex,
    nodeId,
    isEditState,
    isCollapsed,
    onExpand,
    editSessionKey,
    onOpenEvalTab,
    summaryId,
  }: {
    role: string;
    content: ContentInterface[];
    setIsEdit: React.Dispatch<React.SetStateAction<boolean>>;
    messageIndex: number;
    nodeId?: string;
    isEditState: boolean;
    isCollapsed: boolean;
    onExpand?: () => void;
    summaryId?: string;
    editSessionKey: string;
    onOpenEvalTab?: (tab?: TabId) => void;
  }) => {
    const contentSurfaceClass =
      'rounded-2xl bg-white/60 px-4 pt-2.5 pb-2 shadow-sm ring-1 ring-black/5 dark:bg-gray-900/20 dark:ring-white/10 md:px-5 md:pt-3 md:pb-2.5';
    const contentMinHeightClass = 'min-h-[5.25rem]';
    const { t } = useTranslation();
    const {
      handleRegenerate,
      isUnknownContextConfirmOpen,
      setIsUnknownContextConfirmOpen,
      unknownContextConfirmMessage,
      handleUnknownContextConfirm,
      handleUnknownContextCancel,
    } = useSubmit();
    const [isDelete, setIsDelete] = useState(false);

    const currentChatIndex = useStore((state) => state.currentChatIndex);
    const removeNode = useStore((state) => state.removeNode);
    const moveNode = useStore((state) => state.moveNode);
    const lastMessageIndex = useStore((state) =>
      state.chats?.[state.currentChatIndex]?.messages
        ? state.chats[state.currentChatIndex].messages.length - 1
        : 0
    );
    const inlineLatex = useStore((state) => state.inlineLatex);
    const markdownMode = useStore((state) => state.markdownMode);
    const streamingMarkdownPolicy = useStore((state) => state.streamingMarkdownPolicy);
    const currentChatId = useStore((state) =>
      state.chats?.[state.currentChatIndex]?.id ?? ''
    );
    const isGeneratingMessage = useStore((state) =>
      !!nodeId &&
      Object.values(state.generatingSessions).some(
        (s) => s.chatId === currentChatId && s.targetNodeId === nodeId
      )
    );
    const isCurrentChatGenerating = useStore((state) =>
      Object.values(state.generatingSessions).some((s) => s.chatId === currentChatId)
    );
    const isProtected = useStore((state) => {
      const mapKey = String(state.currentChatIndex);
      const chat = state.chats?.[state.currentChatIndex];
      const resolvedNodeId = nodeId ?? chat?.branchTree?.activePath?.[messageIndex] ?? String(messageIndex);
      const protectedNodes = state.protectedNodeMaps[mapKey] ?? chat?.protectedNodes ?? {};
      return protectedNodes[resolvedNodeId] ?? false;
    });


    // Edit logic (only used when editing, but hook must always be called)
    const editLogic = useEditViewLogic({
      content,
      setIsEdit,
      messageIndex,
      nodeId,
      sticky: false,
      editSessionKey,
      summaryId,
    });

    // Resolve current message index from active path
    const resolveCurrentMessageIndex = () => {
      if (!nodeId) return messageIndex;
      const activePath =
        useStore.getState().chats?.find(chat => chat.id === currentChatId)?.branchTree?.activePath ?? [];
      const resolvedIndex = activePath.indexOf(nodeId);
      return resolvedIndex;
    };

    // User message operations
    const handleDelete = () => {
      if (summaryId) useStore.getState().removeBubbleSummary(currentChatId, summaryId);
      else removeNode({ chatId: currentChatId, nodeId: nodeId ?? String(messageIndex) });
    };
    const handleMove = (direction: 'up' | 'down') => {
      moveNode({ chatId: currentChatId, nodeId: nodeId ?? String(messageIndex), direction });
    };
    const handleRefresh = () => {
      if (isCurrentChatGenerating) return;
      const index = resolveCurrentMessageIndex();
      if (index < 0) return;
      const plan = resolveRegenerateTarget(
        role as Role,
        index,
        useStore.getState().chats![currentChatIndex].messages.length
      );
      if (!plan) return;
      if (!confirmChatModelFavorite(currentChatIndex)) return;
      if (plan.removeIndex >= 0) {
        const chat = useStore.getState().chats?.find(chat => chat.id === currentChatId);
        const result = removeNode({ chatId: currentChatId, nodeId: chat?.branchTree?.activePath[plan.removeIndex] ?? String(plan.removeIndex) });
        if (result.status !== 'updated') return;
      }
      handleRegenerate(plan.submitMode === 'append' ? 'append' : 'midchat', plan.insertIndex);
    };

    const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);
    const [streamVisible, setStreamVisible] = useState(true);
    useEffect(() => {
      if (!isGeneratingMessage || !contentElement) return;
      const observer = new IntersectionObserver(([entry]) => setStreamVisible(entry.isIntersecting));
      observer.observe(contentElement);
      return () => observer.disconnect();
    }, [isGeneratingMessage, contentElement]);
    const streamingText = useStreamingText(currentChatId, isGeneratingMessage ? nodeId : undefined, streamVisible);
    const streamingReasoning = useStreamingReasoning(currentChatId, isGeneratingMessage ? nodeId : undefined, streamVisible, false);
    // Resolve reasoning: from streaming buffer during generation, from persisted content otherwise
    const persistedReasoning = Array.isArray(content)
      ? content.filter(isReasoningContent).map((c) => c.text).join('')
      : '';
    const currentReasoning = streamingReasoning ?? persistedReasoning;
    const firstTextItem = Array.isArray(content)
      ? content.find(isTextContent)
      : undefined;
    const currentTextContent = streamingText ?? (firstTextItem?.text ?? '');
    const handleCopy = () => {
      navigator.clipboard.writeText(currentTextContent);
    };
    const validImageContents = Array.isArray(content)
      ? (content.slice(1).filter(isImageContent) as ImageContentInterface[])
      : [];

    const previewText = currentTextContent.replace(/\s+/g, ' ').trim();
    const collapsedPreview = previewText
      ? previewText.length > 280 ? `${previewText.slice(0, 280)}...` : previewText
      : `${role} message`;
    const handleEdit: React.Dispatch<React.SetStateAction<boolean>> = (value) => {
      const nextValue = typeof value === 'function' ? value(isEditState) : value;
      if (nextValue && isCollapsed) onExpand?.();
      setIsEdit(nextValue);
    };

    return (
      <>
        {isEditState && (
          <div hidden={isCollapsed} ref={setContentElement} className={contentSurfaceClass}>
            <MessageEditForm logic={editLogic} role={role} messageIndex={messageIndex} editorClassName={contentMinHeightClass} textOnly={!!summaryId} />
          </div>
        )}
        {(!isEditState || isCollapsed) && (
          <div ref={setContentElement} className={`${contentSurfaceClass} relative`}>
            {isCollapsed ? (
              <div className='h-[4.5rem] overflow-hidden text-sm leading-6 text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words line-clamp-3'>
                {collapsedPreview}
              </div>
            ) : (
              <>
                {role === 'assistant' && currentReasoning && (
                  <CollapsibleReasoning
                    chatId={currentChatId}
                    reasoning={currentReasoning}
                    nodeId={nodeId}
                    visible={streamVisible}
                    isGenerating={isGeneratingMessage}
                  />
                )}
                <div className={contentMinHeightClass}>
                  <ContentBody
                    currentTextContent={currentTextContent}
                    markdownMode={markdownMode}
                    streamingMarkdownPolicy={streamingMarkdownPolicy}
                    inlineLatex={inlineLatex}
                    isGeneratingMessage={isGeneratingMessage}
                    nodeId={nodeId}
                  />
                </div>
                <ContentAttachments images={isEditState ? [] : validImageContents} />
                {nodeId && currentChatId && !summaryId && (
                  <>
                    <EvaluationPanel chatId={currentChatId} nodeId={nodeId} phase='pre-send' onOpenTab={onOpenEvalTab} />
                    <EvaluationPanel chatId={currentChatId} nodeId={nodeId} phase='post-receive' onOpenTab={onOpenEvalTab} />
                  </>
                )}
              </>
            )}
            <ContentActions
              nodeId={nodeId}
              currentChatIndex={currentChatIndex}
              role={role}
              messageIndex={messageIndex}
              lastMessageIndex={lastMessageIndex}
              isDelete={isDelete}
              isProtected={isProtected}
              isGeneratingMessage={isGeneratingMessage}
              isCurrentChatGenerating={isCurrentChatGenerating}
              setIsEdit={handleEdit}
              setIsDelete={setIsDelete}
              onRefresh={handleRefresh}
              onMoveUp={() => handleMove('up')}
              onMoveDown={() => handleMove('down')}
              onCopy={handleCopy}
              onDelete={handleDelete}
            />
            {isUnknownContextConfirmOpen && (
              <PopupModal
                setIsModalOpen={setIsUnknownContextConfirmOpen}
                title={t('warning') as string}
                message={unknownContextConfirmMessage}
                handleConfirm={handleUnknownContextConfirm}
                handleClose={handleUnknownContextCancel}
              />
            )}
          </div>
        )}
      </>
    );
  }
);

export default UnifiedMessageView;
