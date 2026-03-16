import React from 'react';
import TickIcon from '@icon/TickIcon';
import CrossIcon from '@icon/CrossIcon';

import RefreshButton from './Button/RefreshButton';
import RegenerateNextButton from './Button/RegenerateNextButton';
import UpButton from './Button/UpButton';
import DownButton from './Button/DownButton';
import CopyButton from './Button/CopyButton';
import EditButton from './Button/EditButton';
import DeleteButton from './Button/DeleteButton';
import MarkdownModeButton from './Button/MarkdownModeButton';
import BranchSwitcher from '../BranchSwitcher';
import useStore from '@store/store';
import { isSplitView } from '@type/chat';

function ShowInBranchEditorButton({ nodeId }: { nodeId: string }) {
  const setBranchEditorFocusNodeId = useStore((state) => state.setBranchEditorFocusNodeId);
  const setChatActiveView = useStore((state) => state.setChatActiveView);
  const chatActiveView = useStore((state) => state.chatActiveView);
  const navigateToBranchEditor = useStore((state) => state.navigateToBranchEditor);

  const handleClick = () => {
    setBranchEditorFocusNodeId(nodeId);
    if (isSplitView(chatActiveView)) {
      // Already visible, just focus
    } else {
      navigateToBranchEditor();
    }
  };

  return (
    <button
      className='p-1 hover:text-white'
      aria-label='Show in branch editor'
      title='ブランチエディタで表示'
      onClick={handleClick}
    >
      <svg
        stroke='currentColor'
        fill='none'
        strokeWidth='2'
        viewBox='0 0 24 24'
        strokeLinecap='round'
        strokeLinejoin='round'
        className='h-4 w-4'
        xmlns='http://www.w3.org/2000/svg'
      >
        <circle cx='12' cy='5' r='2' />
        <circle cx='6' cy='19' r='2' />
        <circle cx='18' cy='19' r='2' />
        <line x1='12' y1='7' x2='12' y2='13' />
        <line x1='12' y1='13' x2='6' y2='17' />
        <line x1='12' y1='13' x2='18' y2='17' />
      </svg>
    </button>
  );
}

type ContentActionsProps = {
  nodeId?: string;
  currentChatIndex: number;
  role: string;
  messageIndex: number;
  lastMessageIndex: number;
  isDelete: boolean;
  isGeneratingMessage: boolean;
  isCurrentChatGenerating: boolean;
  setIsEdit: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDelete: React.Dispatch<React.SetStateAction<boolean>>;
  onRefresh: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onCopy: () => void;
  onDelete: () => void;
};

export default function ContentActions({
  nodeId,
  currentChatIndex,
  role,
  messageIndex,
  lastMessageIndex,
  isDelete,
  isGeneratingMessage,
  isCurrentChatGenerating,
  setIsEdit,
  setIsDelete,
  onRefresh,
  onMoveUp,
  onMoveDown,
  onCopy,
  onDelete,
}: ContentActionsProps) {
  return (
    <div className='sticky bottom-3 z-20 mt-3 -mx-2 flex w-[calc(100%+1rem)] flex-nowrap items-center justify-between gap-x-3 gap-y-2 px-2 py-2 transition duration-150 md:pointer-events-none md:translate-y-2 md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:translate-y-0 md:group-hover:opacity-100'>
      <div className='min-w-0'>
        {nodeId && (
          <BranchSwitcher
            chatIndex={currentChatIndex}
            nodeId={nodeId}
          />
        )}
      </div>
      <div className='ml-auto flex flex-wrap items-center justify-end gap-2 rounded-xl bg-white/75 px-2 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:bg-gray-800/75 dark:supports-[backdrop-filter]:bg-gray-800/60'>
        {isDelete || (
          <>
            {!isCurrentChatGenerating && role === 'assistant' && (
              <RefreshButton onClick={onRefresh} />
            )}
            {!isCurrentChatGenerating && role === 'user' && (
              <RegenerateNextButton onClick={onRefresh} />
            )}
            {messageIndex !== 0 && <UpButton onClick={onMoveUp} />}
            {messageIndex !== lastMessageIndex && (
              <DownButton onClick={onMoveDown} />
            )}

            {nodeId && <ShowInBranchEditorButton nodeId={nodeId} />}
            <MarkdownModeButton />
            <CopyButton onClick={onCopy} />
            {!isGeneratingMessage && <EditButton setIsEdit={setIsEdit} />}
            <DeleteButton setIsDelete={setIsDelete} />
          </>
        )}
        {isDelete && (
          <>
            <button
              className='p-1 hover:text-white'
              aria-label='cancel'
              onClick={() => setIsDelete(false)}
            >
              <CrossIcon />
            </button>
            <button
              className='p-1 hover:text-white'
              aria-label='confirm'
              onClick={onDelete}
            >
              <TickIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
