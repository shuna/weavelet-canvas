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
import ShowInEditorButton from './Button/ShowInEditorButton';
import BranchSwitcher from '../BranchSwitcher';

type ContentActionsProps = {
  nodeId?: string;
  currentChatIndex: number;
  role: string;
  messageIndex: number;
  lastMessageIndex: number;
  isDelete: boolean;
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
    <div className='mt-2 flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2'>
      <div className='min-w-0'>
        {nodeId && (
          <BranchSwitcher
            chatIndex={currentChatIndex}
            nodeId={nodeId}
          />
        )}
      </div>
      <div className='ml-auto flex flex-wrap items-center justify-end gap-2'>
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

            <MarkdownModeButton />
            <CopyButton onClick={onCopy} />
            <EditButton setIsEdit={setIsEdit} />
            <ShowInEditorButton messageIndex={messageIndex} />
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
