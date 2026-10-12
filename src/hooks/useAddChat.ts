import React from 'react';
import useStore from '@store/store';
import { generateDefaultChat } from '@constants/chat';
import { addLibraryChat } from '@utils/chatLibrary';
/* no deep clone needed – just prepend a new default chat */

const useAddChat = () => {
  const setChats = useStore((state) => state.setChats);
  const setCurrentChatIndex = useStore((state) => state.setCurrentChatIndex);
  const pushNavigationEntry = useStore((state) => state.pushNavigationEntry);
  const captureCurrentNavigationEntry = useStore((state) => state.captureCurrentNavigationEntry);

  const addChat = (folder?:string) => {
    const chats = useStore.getState().chats;
    if (chats) {
      const updatedChats = addLibraryChat(chats, title => generateDefaultChat(title, folder));
      const chat = updatedChats[0];
      captureCurrentNavigationEntry();
      setChats(updatedChats);
      pushNavigationEntry({ chatId: chat.id, activePath: [...(chat.branchTree?.activePath ?? [])], viewContext: useStore.getState().chatActiveView, source: 'chat-switch' });
      setCurrentChatIndex(0);
    }
  };

  return addChat;
};

export default useAddChat;
