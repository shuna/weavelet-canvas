import { isAssistantPrefillLocation } from '@utils/assistantPrefill';
import { normalizeBubbleSummaryText } from '@utils/bubbleSummary';
import { useSyncReview, acknowledgeSyncNode } from '@store/storage/google/conflicts';
import { useTranslation } from 'react-i18next';
import React, { useCallback, useState } from 'react';
import { useWorkspaceStore, useWorkspaceReadOnly } from '@store/workspaceScope';

import Avatar from './Avatar';
import MessageContent from './MessageContent';

import { ContentInterface, Role, isSplitView } from '@type/chat';
import RoleSelector from './RoleSelector';
import useIsDesktop from '@hooks/useIsDesktop';
import useCanHover from '@hooks/useCanHover';
import MetaActions from './View/MetaActions';
import EvaluationModal, { type TabId } from './View/EvaluationModal';
import { resolveProviderForModel } from '@hooks/submitHelpers';
import BubbleSummaryView from './View/BubbleSummaryView';
import AssistantPrefillSeed from '../AssistantPrefillSeed';
import { STICKY_PREFILL_KEY } from '@store/input-slice';
import useMessageBranchSwipe from '@hooks/useMessageBranchSwipe';

const backgroundStyle = ['dark:bg-gray-800', 'bg-gray-50 dark:bg-gray-650'];

const CollapseToggle = ({
  isCollapsed,
  canHover,
  onClick,
}: {
  isCollapsed: boolean;
  canHover: boolean;
  onClick: () => void;
}) => (
  <button
    type='button'
    className={`collapse-toggle absolute left-px top-[4.2rem] bottom-2 z-10 w-6 rounded-full touch-manipulation transition-all duration-200 md:left-0 md:top-2 md:w-5 ${
      isCollapsed
        ? 'before:absolute before:left-[9px] before:top-0 before:bottom-0 before:w-1.5 before:rounded-full before:bg-gray-300/50 dark:before:bg-gray-500/40 hover:before:bg-gray-400/60 dark:hover:before:bg-gray-400/50 md:before:left-1.5'
        : canHover
          ? 'before:absolute before:left-[9px] before:top-0 before:bottom-0 before:w-1.5 before:rounded-full before:bg-gray-300/0 before:opacity-0 hover:before:bg-gray-300/70 hover:before:opacity-100 focus-visible:before:bg-gray-300/70 focus-visible:before:opacity-100 dark:before:bg-gray-500/0 dark:hover:before:bg-gray-500/60 dark:focus-visible:before:bg-gray-500/60 md:before:left-1.5'
          : 'before:absolute before:left-[9px] before:top-0 before:bottom-0 before:w-1.5 before:rounded-full before:bg-transparent active:before:bg-gray-400/60 dark:active:before:bg-gray-400/50 md:before:left-1.5'
    }`}
    onClick={onClick}
    aria-label={isCollapsed ? 'Expand message' : 'Collapse message'}
    title={isCollapsed ? 'Expand' : 'Collapse'}
  />
);

const Message = React.memo(
  ({
    role,
    content,
    messageIndex,
    nodeId,
    sticky = false,
  }: {
    role: Role;
    content: ContentInterface[],
    messageIndex: number;
    nodeId?: string;
    sticky?: boolean;
  }) => {
  const useStore = useWorkspaceStore();
  const readOnly = useWorkspaceReadOnly();

    const hideSideMenu = useStore((state) => state.hideSideMenu);
    const advancedMode = useStore((state) => state.advancedMode);
    const setNodeCollapsed = useStore((state) => state.setNodeCollapsed);
    const currentChatIndex = useStore((state) => state.currentChatIndex);
    const setHoveredNodeId = useStore((state) => state.setHoveredNodeId);
    const setBranchEditorFocusNodeId = useStore((state) => state.setBranchEditorFocusNodeId);
    const chatActiveView = useStore((state) => state.chatActiveView);
    const branchEditorSyncEnabled = useStore((state) => state.branchEditorSyncEnabled);
    const pushNavigationEntry = useStore((state) => state.pushNavigationEntry);
    const isDesktop = useIsDesktop();
    const canHover = useCanHover();
    const isDesktopMenuExpanded = isDesktop && !hideSideMenu;

    const resolvedNodeId = useStore((state) => {
      if (sticky) return undefined;
      if (nodeId) return nodeId;
      const chat = state.chats?.[state.currentChatIndex];
      return chat?.branchTree?.activePath?.[messageIndex] ?? String(messageIndex);
    });

    const { t } = useTranslation('drive');
    const swipeRef = useMessageBranchSwipe(currentChatIndex, sticky ? undefined : resolvedNodeId);
    const chatId = useStore(state => state.chats?.[state.currentChatIndex]?.id ?? '');
    const isGeneratingMessage = useStore((state) =>
      !!resolvedNodeId && Object.values(state.generatingSessions).some(
        (session) => session.chatId === chatId && session.targetNodeId === resolvedNodeId
      )
    );
    const [isEvalModalOpen, setIsEvalModalOpen] = useState(false);
    const [evalInitialTab, setEvalInitialTab] = useState<TabId | undefined>();
    const handleOpenEvalTab = useCallback((tab?: TabId) => {
      setEvalInitialTab(tab);
      setIsEvalModalOpen(true);
    }, []);

    const syncChanged = useSyncReview(state => !!resolvedNodeId && (state.nodes[chatId] ?? []).includes(resolvedNodeId));

    const isCollapsed = useStore((state) => {
      if (sticky || !resolvedNodeId) return false;
      const chatIndex = state.currentChatIndex;
      const collapsedNodes =
        state.collapsedNodeMaps[String(chatIndex)] ??
        state.chats?.[chatIndex]?.collapsedNodes ??
        {};
      return collapsedNodes[resolvedNodeId] ?? false;
    });

    const isOmitted = useStore((state) => {
      if (sticky || !resolvedNodeId) return false;
      const chatIndex = state.currentChatIndex;
      const omittedNodes =
        state.omittedNodeMaps[String(chatIndex)] ??
        state.chats?.[chatIndex]?.omittedNodes ??
        {};
      return omittedNodes[resolvedNodeId] ?? false;
    });

    const isProtected = useStore((state) => {
      if (sticky || !resolvedNodeId) return false;
      const chatIndex = state.currentChatIndex;
      const protectedNodes =
        state.protectedNodeMaps[String(chatIndex)] ??
        state.chats?.[chatIndex]?.protectedNodes ??
        {};
      return protectedNodes[resolvedNodeId] ?? false;
    });

    const handleToggleCollapse = useCallback(() => {
      if (!sticky) {
        if (resolvedNodeId) setNodeCollapsed({ chatId, nodeId: resolvedNodeId, value: !isCollapsed });
      }
    }, [chatId, resolvedNodeId, isCollapsed, sticky, setNodeCollapsed]);

    const handleMouseEnter = useCallback(() => {
      if (!sticky && isSplitView(chatActiveView)) {
        setHoveredNodeId(resolvedNodeId ?? null);
      }
    }, [sticky, chatActiveView, resolvedNodeId, setHoveredNodeId]);

    const handleMouseLeave = useCallback(() => {
      if (!sticky && isSplitView(chatActiveView)) {
        setHoveredNodeId(null);
      }
    }, [sticky, chatActiveView, setHoveredNodeId]);

    const handleClick = useCallback(() => {
      if (!sticky && resolvedNodeId && isSplitView(chatActiveView) && branchEditorSyncEnabled) {
        const state = useStore.getState();
        const chat = state.chats?.[state.currentChatIndex];
        if (chat?.branchTree) {
          pushNavigationEntry({
            chatId: chat.id,
            activePath: [...chat.branchTree.activePath],
            focusedNodeId: resolvedNodeId,
            viewContext: chatActiveView,
            source: 'chat-click',
          });
        }
        setBranchEditorFocusNodeId(resolvedNodeId);
      }
    }, [sticky, resolvedNodeId, chatActiveView, branchEditorSyncEnabled, setBranchEditorFocusNodeId, pushNavigationEntry]);

    const maxWidthClass = isDesktopMenuExpanded
      ? 'md:max-w-3xl lg:max-w-3xl xl:max-w-4xl'
      : 'md:max-w-4xl lg:max-w-4xl xl:max-w-5xl';

    return (
      <div
        className={`w-full border-b border-black/10 dark:border-gray-900/50 text-gray-800 dark:text-gray-100 group relative ${
          backgroundStyle[messageIndex % 2]
        }${isOmitted ? ' opacity-50' : ''}${
          isProtected ? ' ring-2 ring-inset ring-blue-400/30 dark:ring-blue-500/25' : ''
        }`}
        data-sync-node-changed={syncChanged || undefined}
        style={syncChanged ? { outline: '2px solid #f59e0b', outlineOffset: '-2px' } : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {!readOnly && syncChanged && <button type='button' className='relative z-10 px-7 pt-2 text-xs text-amber-700 dark:text-amber-300' onClick={event => { event.stopPropagation(); acknowledgeSyncNode(chatId, resolvedNodeId!); }}>{t('review.nodeDone')}</button>}
        {!sticky && (
          <CollapseToggle
            isCollapsed={isCollapsed}
            canHover={canHover}
            onClick={handleToggleCollapse}
          />
        )}
        <div
          className={`bubble-message-layout text-base gap-1.5 md:gap-2 m-auto px-7 py-6 md:py-8 flex flex-col transition-all ease-in-out ${maxWidthClass}`}
        >
          {sticky ? (
            <>
              <div className='flex flex-wrap items-center gap-2.5'>
                <Avatar role={role} />
                {advancedMode && (
                  <RoleSelector role={role} sticky allowSystem={false} />
                )}
              </div>
              <div className='w-full'>
                <MessageContent
                  role={role}
                  content={content}
                  messageIndex={messageIndex}
                  nodeId={resolvedNodeId}
                  sticky={sticky}
                />
              </div>
              {isAssistantPrefillLocation({sticky: true, role}) && (
                <AssistantPrefillSeed nodeId={STICKY_PREFILL_KEY} />
              )}
            </>
          ) : (
            <>
              <div className='flex flex-wrap items-center gap-2.5'>
                <Avatar role={role} />
                {!readOnly && advancedMode && resolvedNodeId && (
                  <RoleSelector role={role} nodeId={resolvedNodeId} messageIndex={messageIndex} allowSystem={messageIndex === 0} />
                )}
                <div className='ml-auto min-w-0 max-w-full'>
                  <MetaActions
                    chatId={chatId}
                    nodeId={resolvedNodeId ?? ''}
                    isOmitted={isOmitted}
                    isProtected={isProtected}
                    showEvaluateButton={!isGeneratingMessage}
                    onEvaluate={() => handleOpenEvalTab()}
                  />
                </div>
              </div>
              <div className='min-w-0' ref={swipeRef}>
                <BubbleSummaryView nodeId={resolvedNodeId} isCollapsed={isCollapsed} renderSummary={summary => <MessageContent role='user' content={[{ type: 'text', text: normalizeBubbleSummaryText(summary.text) }]} messageIndex={messageIndex} nodeId={resolvedNodeId} summaryId={summary.id} />}>
                <MessageContent
                  role={role}
                  content={content}
                  messageIndex={messageIndex}
                  nodeId={resolvedNodeId}
                  sticky={sticky}
                  onOpenEvalTab={handleOpenEvalTab}
                  isCollapsed={isCollapsed}
                  onExpand={handleToggleCollapse}
                />
                </BubbleSummaryView>
              </div>
              {isAssistantPrefillLocation({sticky: false, role, nodeId: resolvedNodeId, readOnly, collapsed: isCollapsed}) && (
                <AssistantPrefillSeed nodeId={resolvedNodeId!} />
              )}
            </>
          )}
        </div>
        {isEvalModalOpen && resolvedNodeId && chatId && (() => {
          const state = useStore.getState();
          const chat = state.chats?.[currentChatIndex];
          if (!chat) return null;
          const resolvedIndex = chat.branchTree?.activePath.indexOf(resolvedNodeId) ?? -1;
          return (
            <EvaluationModal
              chatId={chatId}
              nodeId={resolvedNodeId}
              chatIndex={currentChatIndex}
              messageIndex={resolvedIndex >= 0 ? resolvedIndex : messageIndex}
              phase={role === 'user' ? 'pre-send' : 'post-receive'}
              role={role}
              resolvedProvider={resolveProviderForModel(
                chat.config.model,
                state.favoriteModels || [],
                state.providers || {},
                { endpoint: state.apiEndpoint, key: state.apiKey },
                chat.config.providerId
              )}
              model={chat.config.model}
              setIsModalOpen={setIsEvalModalOpen}
              initialTab={evalInitialTab}
            />
          );
        })()}
        {isCollapsed && (
          <div className='absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white/90 dark:from-gray-800/90 to-transparent pointer-events-none' />
        )}
      </div>
    );
  }
);

export default Message;
