import React, { Suspense, useEffect, useRef, useState } from 'react';
import useStore from '@store/store';
import { isSplitView } from '@type/chat';

import ChatContent from './ChatContent';
import MobileBar from '../MobileBar';
import SplitView from './SplitView';

import ChatViewTabs from './ChatViewTabs';
import NavigationButtons from './NavigationButtons';
import useIsDesktop from '@hooks/useIsDesktop';
import useNavigationHistory from '@hooks/useNavigationHistory';
import UndoRedoButtons from './UndoRedoButtons';

const BranchEditorView = React.lazy(
  () => import('@components/BranchEditor/BranchEditorView')
);

const Chat = () => {
  const hideSideMenu = useStore((state) => state.hideSideMenu);
  const menuWidth = useStore((state) => state.menuWidth);
  const activeView = useStore((state) => state.chatActiveView);
  const setActiveView = useStore((state) => state.setChatActiveView);
  const currentChat = useStore((state) => state.chats?.[state.currentChatIndex]);
  const pushNavigationEntry = useStore((state) => state.pushNavigationEntry);
  const isRestoringNavigation = useStore((state) => state.isRestoringNavigation);
  const isDesktop = useIsDesktop();
  const desktopOffset = isDesktop && !hideSideMenu ? `${menuWidth}px` : '0';
  const [isChatFindOpen, setIsChatFindOpen] = useState(false);

  useNavigationHistory();
  const previousViewRef = useRef(activeView);

  useEffect(() => {
    if (previousViewRef.current === activeView) return;
    previousViewRef.current = activeView;
    if (isRestoringNavigation || !currentChat) return;
    const currentEntry = useStore.getState().navHistoryCurrent;
    if (currentEntry?.chatId === currentChat.id && currentEntry.viewContext === activeView) return;
    pushNavigationEntry({
      chatId: currentChat.id,
      activePath: [...(currentChat.branchTree?.activePath ?? [])],
      viewContext: activeView,
      source: 'view-switch',
    });
  }, [activeView, currentChat, isRestoringNavigation, pushNavigationEntry]);

  // Mobile fallback: split views degrade to chat view
  const effectiveView = !isDesktop && isSplitView(activeView) ? 'chat' : activeView;

  return (
    <div className='flex h-full flex-1 flex-col' style={{ paddingLeft: desktopOffset }}>
      <MobileBar
        onSearchOpen={() => setIsChatFindOpen(true)}
        extraButtons={<NavigationButtons />}
      />
      <main className='relative h-full w-full transition-width flex flex-col overflow-hidden items-stretch flex-1'>
        <div className='relative shrink-0'>
          <ChatViewTabs activeView={effectiveView} setActiveView={setActiveView} />
          <div id='google-sync-banner-overlay' className='absolute inset-x-0 top-full z-[60]' />
        </div>
        {effectiveView === 'branch-editor' && (
          <div className='absolute left-2 bottom-2 z-30 flex flex-col gap-1.5 md:left-4 md:bottom-3'>
            <UndoRedoButtons />
          </div>
        )}
        {isSplitView(effectiveView) ? (
          <SplitView direction={effectiveView === 'split-horizontal' ? 'horizontal' : 'vertical'} />
        ) : (
          <>
            <div className={effectiveView === 'chat' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
              <ChatContent isChatFindOpen={isChatFindOpen} onChatFindClose={() => setIsChatFindOpen(false)} />
            </div>
            {effectiveView === 'branch-editor' && (
              <div className='flex flex-col flex-1 overflow-hidden'>
                <Suspense fallback={<div className='flex items-center justify-center flex-1'><div className='animate-spin rounded-full h-8 w-8 border-b-2 border-gray-500'></div></div>}>
                  <BranchEditorView />
                </Suspense>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Chat;
