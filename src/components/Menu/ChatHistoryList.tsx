import { getFolderAncestors, getFolderParentId } from '@utils/folderHierarchy';
import { readDraggedChatIds } from './chatHistoryFolderUtils';
import React, { useEffect, useRef, useState } from 'react';
import { useWorkspaceStore, useWorkspaceReadOnly, useWorkspaceScope } from '@store/workspaceScope';
import { shallow } from 'zustand/shallow';

import ChatFolder from './ChatFolder';
import ChatHistory from './ChatHistory';
import GrepResults from './GrepResults';
import SidebarSearchHistory from './SidebarSearchHistory';
import { expandExistingFolder } from './chatHistoryFolderUtils';

import {
  ChatHistoryInterface,
  ChatHistoryFolderInterface,
  ChatInterface,
  FolderCollection,
  isImageContent,
  isTextContent,
} from '@type/chat';

const ChatHistoryList = ({
  filter,
  setFilter,
  searchFocused,
  onHistorySelect,
}: {
  filter: string;
  setFilter: React.Dispatch<React.SetStateAction<string>>;
  searchFocused?: boolean;
  onHistorySelect?: (query: string) => void;
}) => {
  const useStore = useWorkspaceStore();
  const readOnly = useWorkspaceReadOnly();

  const currentChatIndex = useStore((state) => state.currentChatIndex);
  const hideSideMenu = useStore((state) => state.hideSideMenu);
  const displayChatSize = useStore((state) => state.displayChatSize);
  const setFolders = useStore((state) => state.setFolders);
  const folders = useStore(state => state.folders);
  const chatTitles = useStore(
    (state) => state.chats?.map((chat) => chat.title),
    shallow
  );

  const [isHover, setIsHover] = useState<boolean>(false);
  const [chatFolders, setChatFolders] = useState<ChatHistoryFolderInterface>(
    {}
  );
  const [noChatFolders, setNoChatFolders] = useState<ChatHistoryInterface[]>(
    []
  );
  const isGrepMode = useStore((state) => state.isGrepMode);
  const sidebarSearchHistory = useStore((state) => state.sidebarSearchHistory);
  const grepQuery = useStore((state) => state.grepQuery);
  const scope = useWorkspaceScope();
  const [localSelection, setLocalSelection] = useState<number[]>(() => readOnly ? [] : [...useStore.getState().multiViewChatIndices]);
  const selectionChats = useStore(state => state.chats);
  const selectedChats = readOnly ? (selectionChats ?? []).flatMap((chat, index) => scope?.selectedIds.includes(chat.id) ? [index] : []) : localSelection;
  const setSelectedChats = (indices: number[]) => {
    if (readOnly) scope?.setSelectedIds(indices.flatMap(index => selectionChats?.[index]?.id ? [selectionChats[index].id] : []));
    else setLocalSelection(indices);
  };
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null
  );

  // Sync sidebar selection to multi-view store for branch editor comparison
  const setMultiViewChatIndices = useStore((state) => state.setMultiViewChatIndices);

  useEffect(() => {
    if (!readOnly) setMultiViewChatIndices(selectedChats);
  }, [selectedChats, setMultiViewChatIndices]);

  const chatsRef = useRef<ChatInterface[]>(useStore.getState().chats || []);
  const foldersRef = useRef<FolderCollection>(useStore.getState().folders);
  const filterRef = useRef<string>(filter);
  const listRef = useRef<HTMLDivElement>(null);

  const updateFolders = useRef(() => {
    const _folders: ChatHistoryFolderInterface = {};
    const _noFolders: ChatHistoryInterface[] = [];
    const chats = useStore.getState().chats;
    const folders = useStore.getState().folders;
    const displayChatSize = useStore.getState().displayChatSize;

    Object.values(folders)
      .sort((a, b) => a.order - b.order)
      .forEach((f) => (_folders[f.id] = []));

    if (chats) {
      chats.forEach((chat, index) => {
        const _filterLowerCase = filterRef.current.toLowerCase();
        const _chatTitle = chat.title.toLowerCase();
        const folder = chat.folder ? folders[chat.folder] : undefined;
        const _chatFolderName = folder ? getFolderAncestors(folders, folder.id).map(id => folders[id].name.toLowerCase()).join(' ') : '';

        if (
          !_chatTitle.includes(_filterLowerCase) &&
          !_chatFolderName.includes(_filterLowerCase) &&
          index !== useStore.getState().currentChatIndex
        )
          return;

        if (!chat.folder) {
          _noFolders.push({
            title: chat.title,
            index: index,
            id: chat.id,
            chatSize: !displayChatSize
              ? undefined
              : chat.messages.reduce(
                  (prev, current) =>
                    prev +
                    current.content.reduce(
                      (prevInner, currCont) =>
                        prevInner +
                        (isTextContent(currCont)
                          ? currCont.text.length
                          : isImageContent(currCont)
                          ? currCont.image_url.url.length
                          : 0),
                      0
                    ),
                  0
                ),
          });
        } else if (folder) {
          if (!_folders[chat.folder]) _folders[chat.folder] = [];
          _folders[chat.folder].push({
            title: chat.title,
            index: index,
            id: chat.id,
            chatSize: !displayChatSize
              ? undefined
              : chat.messages.reduce(
                  (prev, current) =>
                    prev +
                    current.content.reduce(
                      (prevInner, currCont) =>
                        prevInner +
                        (isTextContent(currCont)
                          ? currCont.text.length
                          : isImageContent(currCont)
                          ? currCont.image_url.url.length
                          : 0),
                      0
                    ),
                  0
                ),
          });
        } else {
          _noFolders.push({
            title: chat.title,
            index: index,
            id: chat.id,
            chatSize: !displayChatSize
              ? undefined
              : chat.messages.reduce(
                  (prev, current) =>
                    prev +
                    current.content.reduce(
                      (prevInner, currCont) =>
                        prevInner +
                        (isTextContent(currCont)
                          ? currCont.text.length
                          : isImageContent(currCont)
                          ? currCont.image_url.url.length
                          : 0),
                      0
                    ),
                  0
                ),
          });
        }
      });
    }

    const query = filterRef.current.toLowerCase();
    if (query) {
      const visible = new Set<string>();
      for (const [id, chats] of Object.entries(_folders)) {
        const path = getFolderAncestors(folders, id);
        if (chats.length || path.some(parent => folders[parent].name.toLowerCase().includes(query))) path.forEach(parent => visible.add(parent));
      }
      for (const id of Object.keys(_folders)) if (!visible.has(id)) delete _folders[id];
    }
    setChatFolders(_folders);
    setNoChatFolders(_noFolders);
  }).current;

  useEffect(() => {
    updateFolders();

    const unsubscribe = useStore.subscribe((state) => {
      if (
        Object.keys(state.generatingSessions).length === 0 &&
        state.chats &&
        state.chats !== chatsRef.current
      ) {
        updateFolders();
        chatsRef.current = state.chats;
      } else if (state.folders !== foldersRef.current) {
        updateFolders();
        foldersRef.current = state.folders;
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    updateFolders();
  }, [displayChatSize]);

  useEffect(() => {
    updateFolders();
    if (
      chatTitles &&
      currentChatIndex >= 0 &&
      currentChatIndex < chatTitles.length
    ) {
      // set title
      if (!readOnly) document.title = chatTitles[currentChatIndex];

      // expand folder of current chat
      const chats = useStore.getState().chats;
      if (chats) {
        const folderId = chats[currentChatIndex].folder;

        if (folderId) {
          const currentFolders = useStore.getState().folders;
          const updatedFolders = expandExistingFolder(currentFolders, folderId);
          if (updatedFolders) {
            setFolders(updatedFolders);
          }
        }
      }
    }
  }, [currentChatIndex, chatTitles]);

  useEffect(() => {
    filterRef.current = filter;
    updateFolders();
  }, [filter]);

  useEffect(() => {
    if (hideSideMenu) return;

    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      const activeChat = list?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!list || !activeChat) return;

      const listRect = list.getBoundingClientRect();
      const chatRect = activeChat.getBoundingClientRect();
      list.scrollTo({
        top: list.scrollTop + chatRect.top - listRect.top - (list.clientHeight - chatRect.height) / 2,
        behavior: 'smooth',
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [hideSideMenu]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer) {
      e.stopPropagation();
      setIsHover(false);

      const chatIds = readDraggedChatIds(e.dataTransfer.getData('chatIds'));
      if (!chatIds) return;
      if (useStore.getState().moveChatsToFolder({ chatIds, folderId: null, expandDestination: false }).status === 'applied') setSelectedChats([]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHover(true);
  };

  const handleDragLeave = () => {
    setIsHover(false);
  };

  const handleDragEnd = () => {
    setIsHover(false);
  };

  const folderChildren: Record<string, string[]> = {};
  for (const id of Object.keys(chatFolders)) {
    const parent = getFolderParentId(folders, id) ?? '';
    (folderChildren[parent] ??= []).push(id);
  }
  return (
    <div
      ref={listRef}
      className={`flex flex-1 flex-col overflow-y-auto overscroll-contain border-b border-gray-200 dark:border-white/20 ${
        isHover ? 'bg-gray-200/70 dark:bg-gray-800/40' : ''
      }`}
      onDrop={readOnly ? undefined : handleDrop}
      onDragOver={readOnly ? undefined : handleDragOver}
      onDragLeave={handleDragLeave}
      onDragEnd={handleDragEnd}
    >
      {/* Show search history when focused with empty query */}
      {searchFocused && !filter && !grepQuery && sidebarSearchHistory.length > 0 ? (
        <SidebarSearchHistory onSelect={(q) => onHistorySelect?.(q)} />
      ) : isGrepMode ? (
        <GrepResults />
      ) : (
        <div className='flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-100'>
          {(folderChildren[''] ?? []).map((folderId) => (
            <ChatFolder
              folderChats={chatFolders[folderId]}
              allFolderChats={chatFolders}
              childFolderIds={folderChildren}
              forceExpanded={!!filter}
              folderId={folderId}
              key={folderId}
              selectedChats={selectedChats}
              setSelectedChats={setSelectedChats}
              lastSelectedIndex={lastSelectedIndex}
              setLastSelectedIndex={setLastSelectedIndex}
            />
          ))}
          {noChatFolders.map(({ title, index, id, chatSize }) => (
            <ChatHistory
              title={title}
              chatSize={chatSize}
              key={`${title}-${id}-${index}`}
              chatIndex={index}
              selectedChats={selectedChats}
              setSelectedChats={setSelectedChats}
              lastSelectedIndex={lastSelectedIndex}
              setLastSelectedIndex={setLastSelectedIndex}
            />
          ))}
        </div>
      )}
      <div className='w-full h-10' />
    </div>
  );
};

const ShowMoreButton = () => {
  return (
    <button className='btn relative btn-dark btn-small m-auto mb-2'>
      <div className='flex items-center justify-center gap-2'>Show more</div>
    </button>
  );
};

export default ChatHistoryList;
