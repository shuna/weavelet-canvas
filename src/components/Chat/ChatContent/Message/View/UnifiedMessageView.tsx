import React, { memo, useCallback, useEffect, useState } from 'react';
import useStore from '@store/store';
import useSubmit from '@hooks/useSubmit';
import { confirmChatModelFavorite } from '@utils/chatModelResolution';
import { resolveProviderForModel, type ResolvedProvider } from '@hooks/submitHelpers';
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
import EvaluationModal from './EvaluationModal';
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
    editSessionKey,
  }: {
    role: string;
    content: ContentInterface[];
    setIsEdit: React.Dispatch<React.SetStateAction<boolean>>;
    messageIndex: number;
    nodeId?: string;
    isEditState: boolean;
    editSessionKey: string;
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
    const [isEvalModalOpen, setIsEvalModalOpen] = useState(false);
    const [evalInitialTab, setEvalInitialTab] = useState<TabId | undefined>();

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
      removeNode({ chatId: currentChatId, nodeId: nodeId ?? String(messageIndex) });
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

    const handleEvaluate = useCallback(() => {
      setEvalInitialTab(undefined);
      setIsEvalModalOpen(true);
    }, []);

    const handleOpenEvalTab = useCallback((tab: TabId) => {
      setEvalInitialTab(tab);
      setIsEvalModalOpen(true);
    }, []);

    /** Resolve provider for this chat's model config */
    const getResolvedProvider = useCallback(() => {
      const state = useStore.getState();
      const chat = state.chats?.[currentChatIndex];
      if (!chat) return null;
      const config = chat.config;
      const fallbackProvider: ResolvedProvider = {
        endpoint: state.apiEndpoint,
        key: state.apiKey,
      };
      return {
        resolved: resolveProviderForModel(
          config.model,
          state.favoriteModels || [],
          state.providers || {},
          fallbackProvider,
          config.providerId
        ),
        model: config.model,
      };
    }, [currentChatIndex]);

    const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);
    const [streamVisible, setStreamVisible] = useState(true);
    useEffect(() => {
      if (!isGeneratingMessage || !contentElement) return;
      const observer = new IntersectionObserver(([entry]) => setStreamVisible(entry.isIntersecting));
      observer.observe(contentElement);
      return () => observer.disconnect();
    }, [isGeneratingMessage, contentElement]);
    const streamingText = useStreamingText(isGeneratingMessage ? nodeId : undefined, streamVisible);
    const streamingReasoning = useStreamingReasoning(isGeneratingMessage ? nodeId : undefined, streamVisible, false);
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

    return (
      <>
        {isEditState ? (
          <div ref={setContentElement} className={contentSurfaceClass}>
            <MessageEditForm logic={editLogic} role={role} messageIndex={messageIndex} editorClassName={contentMinHeightClass} />
          </div>
        ) : (
          <div ref={setContentElement} className={`${contentSurfaceClass} relative`}>
            {role === 'assistant' && currentReasoning && (
              <CollapsibleReasoning
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
            {nodeId && currentChatId && (
              <>
                <EvaluationPanel chatId={currentChatId} nodeId={nodeId} phase='pre-send' onOpenTab={handleOpenEvalTab} />
                <EvaluationPanel chatId={currentChatId} nodeId={nodeId} phase='post-receive' onOpenTab={handleOpenEvalTab} />
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
              setIsEdit={setIsEdit}
              setIsDelete={setIsDelete}
              onRefresh={handleRefresh}
              onMoveUp={() => handleMove('up')}
              onMoveDown={() => handleMove('down')}
              onCopy={handleCopy}
              onDelete={handleDelete}
              showEvaluateButton={true}
              onEvaluate={handleEvaluate}
            />
            {(() => {
              if (!isEvalModalOpen || !nodeId || !currentChatId) return null;
              const providerInfo = getResolvedProvider();
              if (!providerInfo) return null;
              return (
                <EvaluationModal
                  chatId={currentChatId}
                  nodeId={nodeId}
                  chatIndex={currentChatIndex}
                  messageIndex={resolveCurrentMessageIndex()}
                  phase={role === 'user' ? 'pre-send' : 'post-receive'}
                  role={role}
                  resolvedProvider={providerInfo.resolved}
                  model={providerInfo.model}
                  setIsModalOpen={setIsEvalModalOpen}
                  initialTab={evalInitialTab}
                />
              );
            })()}
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
