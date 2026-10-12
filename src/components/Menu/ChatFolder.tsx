import { useSyncReview } from '@store/storage/google/conflicts';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { useWorkspaceStore, useWorkspaceReadOnly, useWorkspaceScope } from '@store/workspaceScope';

import DownChevronArrow from '@icon/DownChevronArrow';
import FolderIcon from '@icon/FolderIcon';
import {
  ChatHistoryInterface, ChatHistoryFolderInterface,
} from '@type/chat';

import ChatHistory from './ChatHistory';
import { getFolderSubtreeIds } from '@utils/folderHierarchy';
import { readDraggedChatIds } from './chatHistoryFolderUtils';
import NewChat from './NewChat';
import EditIcon from '@icon/EditIcon';
import DeleteIcon from '@icon/DeleteIcon';
import CrossIcon from '@icon/CrossIcon';
import TickIcon from '@icon/TickIcon';
import ColorPaletteIcon from '@icon/ColorPaletteIcon';
import RefreshIcon from '@icon/RefreshIcon';

import { folderColorOptions } from '@constants/color';

import useHideOnOutsideClick from '@hooks/useHideOnOutsideClick';

const ChatFolder = ({
  folderChats,
  allFolderChats,
  childFolderIds,
  ancestorIds = [],
  forceExpanded = false,
  folderId,
  selectedChats,
  setSelectedChats,
  lastSelectedIndex,
  setLastSelectedIndex,
}: {
  folderChats: ChatHistoryInterface[];
  allFolderChats: ChatHistoryFolderInterface;
  childFolderIds: Record<string, string[]>;
  ancestorIds?: string[];
  forceExpanded?: boolean;
  folderId: string;
  selectedChats: number[];
  setSelectedChats: (indices: number[]) => void;
  lastSelectedIndex: number | null;
  setLastSelectedIndex: (index: number) => void;
}) => {
  const useStore = useWorkspaceStore();
  const readOnly = useWorkspaceReadOnly();

  const { t } = useTranslation('drive');
  const syncChanged = useSyncReview(state => !readOnly && state.folders.includes(folderId));
  const folderName = useStore((state) => state.folders[folderId]?.name);
  const savedExpanded = useStore((state) => state.folders[folderId]?.expanded);
  const isExpanded = forceExpanded || savedExpanded;
  const scope = useWorkspaceScope();
  const folders = useStore(state => state.folders);
  const chats = useStore(state => state.chats);
  const subtree = new Set(readOnly ? getFolderSubtreeIds(folders, folderId) : []);
  const subtreeChatIds = readOnly ? (chats ?? []).filter(chat => chat.folder && subtree.has(chat.folder)).map(chat => chat.id) : [];
  const folderChecked = !!scope && [...subtree].every(id => scope.selectedFolderIds.includes(id)) && subtreeChatIds.every(id => scope.selectedIds.includes(id));
  const folderPartial = !folderChecked && !!scope && ([...subtree].some(id => scope.selectedFolderIds.includes(id)) || subtreeChatIds.some(id => scope.selectedIds.includes(id)));
  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (checkboxRef.current) checkboxRef.current.indeterminate = folderPartial; }, [folderPartial]);
  const toggleSelection = (checked: boolean) => {
    if (!scope) return;
    scope.setSelectedFolderIds(checked ? [...new Set([...scope.selectedFolderIds, ...subtree])] : scope.selectedFolderIds.filter(id => !subtree.has(id)));
    scope.setSelectedIds(checked ? [...new Set([...scope.selectedIds, ...subtreeChatIds])] : scope.selectedIds.filter(id => !subtreeChatIds.includes(id)));
  };
  const color = useStore((state) => state.folders[folderId]?.color);


  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLDivElement>(null);
  const gradientRef = useRef<HTMLDivElement>(null);

  const [_folderName, _setFolderName] = useState<string>(folderName);
  const [isEdit, setIsEdit] = useState<boolean>(false);
  const [isDelete, setIsDelete] = useState<boolean>(false);
  const [isHover, setIsHover] = useState<boolean>(false);

  const [showPalette, setShowPalette, paletteRef] = useHideOnOutsideClick();

  const editTitle = () => {
    useStore.getState().editFolder({ folderId, patch: { name: _folderName } });
    setIsEdit(false);
  };

  const deleteFolder = () => {
    useStore.getState().removeFolder({ folderId });
    setIsDelete(false);
  };

  const updateColor = (_color?: string) => {
    useStore.getState().editFolder({ folderId, patch: { color: _color || null } });
    setShowPalette(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editTitle();
    }
  };

  const handleTick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();

    if (isEdit) editTitle();
    else if (isDelete) deleteFolder();
  };

  const handleCross = () => {
    setIsDelete(false);
    setIsEdit(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer) {
      e.stopPropagation();
      setIsHover(false);

      const chatIds = readDraggedChatIds(e.dataTransfer.getData('chatIds'));
      if (!chatIds) return;
      if (useStore.getState().moveChatsToFolder({ chatIds, folderId, expandDestination: true }).status === 'applied') setSelectedChats([]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsHover(true);
  };

  const handleDragLeave = () => {
    setIsHover(false);
  };

  const toggleExpanded = () => {
    const state = useStore.getState();
    if (readOnly) {
      const folder = state.folders[folderId];
      if (folder) state.setFolders({ ...state.folders, [folderId]: { ...folder, expanded: !folder.expanded } });
    } else state.editFolder({ folderId, patch: { expanded: !state.folders[folderId]?.expanded } });
  };

  useEffect(() => { if (!isEdit) _setFolderName(folderName); }, [folderName, isEdit]);

  useEffect(() => {
    if (inputRef && inputRef.current) inputRef.current.focus();
  }, [isEdit]);

  return (
    <div
      className={`w-full transition-colors group/folder ${
        isHover ? 'bg-gray-200/70 dark:bg-gray-800/40' : ''
      }`}
      onDrop={readOnly ? undefined : handleDrop}
      onDragOver={readOnly ? undefined : handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div
        data-sync-changed={syncChanged || undefined}
        aria-description={syncChanged ? '同期で変更されたフォルダー' : undefined}
        style={{ background: color || '', ...(syncChanged ? { outline: '2px solid #f59e0b', outlineOffset: '-2px' } : {}) }}
        className={`${
          color ? '' : 'bg-gray-50 hover:bg-gray-100 dark:bg-transparent dark:hover:bg-gray-850'
        } parent-sibling relative flex cursor-pointer items-center gap-3 break-all rounded-md py-2 pl-2 pr-1 text-gray-700 transition-colors dark:text-gray-100`}
        onClick={toggleExpanded}
        ref={folderRef}
        onMouseEnter={() => {
          if (color && folderRef.current)
            folderRef.current.style.background = `${color}dd`;
          if (gradientRef.current) gradientRef.current.style.width = '0px';
        }}
        onMouseLeave={() => {
          if (color && folderRef.current)
            folderRef.current.style.background = color;
          if (gradientRef.current) gradientRef.current.style.width = '1rem';
        }}
      >
        {readOnly && <input ref={checkboxRef} type='checkbox' aria-label={`Select folder: ${folderName}`} aria-checked={folderPartial ? 'mixed' : folderChecked} checked={folderChecked} onClick={event => event.stopPropagation()} onChange={event => toggleSelection(event.target.checked)} />}
        <FolderIcon className='h-4 w-4' />
        <div className='flex-1 text-ellipsis max-h-5 overflow-hidden break-all relative'>
          {isEdit ? (
            <input
              type='text'
              className='focus:outline-blue-600 text-sm border-none bg-transparent p-0 m-0 w-full'
              value={_folderName}
              onChange={(e) => {
                _setFolderName(e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={handleKeyDown}
              ref={inputRef}
            />
          ) : (
            _folderName
          )}
          {isEdit || (
            <div
              ref={gradientRef}
              className='absolute inset-y-0 right-0 w-4 z-10 transition-all'
              style={{
                background:
                  color &&
                  `linear-gradient(to left, ${
                    color || 'var(--color-900)'
                  }, rgb(32 33 35 / 0))`,
              }}
            />
          )}
        </div>
        <div
          className={`flex text-gray-500 dark:text-gray-300 ${readOnly ? 'hidden' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          {isDelete || isEdit ? (
            <>
              <button
                className='p-1 hover:text-gray-900 dark:hover:text-white'
                onClick={handleTick}
                aria-label='confirm'
              >
                <TickIcon />
              </button>
              <button
                className='p-1 hover:text-gray-900 dark:hover:text-white'
                onClick={handleCross}
                aria-label='cancel'
              >
                <CrossIcon />
              </button>
            </>
          ) : (
            <>
              <div
                className='relative md:hidden group-hover/folder:md:inline'
                ref={paletteRef}
              >
                <button
                  className='p-1 hover:text-gray-900 dark:hover:text-white'
                  onClick={() => {
                    setShowPalette((prev) => !prev);
                  }}
                  aria-label='folder color'
                >
                  <ColorPaletteIcon />
                </button>
                {showPalette && (
                  <div className='absolute bottom-0 left-0 z-20 flex translate-y-full flex-col items-center gap-2 rounded border border-gray-200 bg-white p-2 text-gray-700 shadow-lg dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'>
                    <>
                      {folderColorOptions.map((c) => (
                        <button
                          key={c}
                          style={{ background: c }}
                          className={`hover:scale-90 transition-transform h-4 w-4 rounded-full`}
                          onClick={() => {
                            updateColor(c);
                          }}
                          aria-label={c}
                        />
                      ))}
                      <button
                        onClick={() => {
                          updateColor();
                        }}
                        aria-label='default color'
                      >
                        <RefreshIcon />
                      </button>
                    </>
                  </div>
                )}
              </div>

              <button
                className='p-1 hover:text-gray-900 dark:hover:text-white md:hidden group-hover/folder:md:inline'
                onClick={() => setIsEdit(true)}
                aria-label='edit folder title'
              >
                <EditIcon />
              </button>
              <button
                className='p-1 hover:text-gray-900 dark:hover:text-white md:hidden group-hover/folder:md:inline'
                onClick={() => setIsDelete(true)}
                aria-label='delete folder'
              >
                <DeleteIcon />
              </button>
              <button
                className='p-1 hover:text-gray-900 dark:hover:text-white'
                onClick={toggleExpanded}
                aria-label='expand folder'
              >
                <DownChevronArrow
                  className={`${
                    isExpanded ? 'rotate-180' : ''
                  } transition-transform`}
                />
              </button>
            </>
          )}
        </div>
      </div>
      {!readOnly && syncChanged && <button type='button' className='px-2 text-xs text-amber-700 dark:text-amber-300' onClick={() => useSyncReview.setState(state => ({ folders: state.folders.filter(id => id !== folderId) }))}>{t('review.folderDone')}</button>}
      <div className='parent ml-3 flex flex-col gap-1 border-l-2 border-gray-200 pl-1 dark:border-gray-700'>
        {isExpanded && (childFolderIds[folderId] ?? []).filter(id => !ancestorIds.includes(id) && id !== folderId).map(id => <ChatFolder key={id} folderId={id} folderChats={allFolderChats[id] ?? []} allFolderChats={allFolderChats} childFolderIds={childFolderIds} ancestorIds={[...ancestorIds, folderId]} forceExpanded={forceExpanded} selectedChats={selectedChats} setSelectedChats={setSelectedChats} lastSelectedIndex={lastSelectedIndex} setLastSelectedIndex={setLastSelectedIndex} />)}
        {!readOnly && isExpanded && <NewChat folder={folderId} />}
        {isExpanded &&
          folderChats.map((chat) => (
            <ChatHistory
              title={chat.title}
              chatIndex={chat.index}
              chatSize={chat.chatSize}
              key={`${chat.title}-${chat.id}-${chat.index}`}
              selectedChats={selectedChats}
              setSelectedChats={setSelectedChats}
              lastSelectedIndex={lastSelectedIndex}
              setLastSelectedIndex={setLastSelectedIndex}
            />
          ))}
      </div>
    </div>
  );
};

export default ChatFolder;
