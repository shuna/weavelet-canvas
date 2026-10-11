import React from 'react';
import useStore from '@store/store';
import { generateDefaultChat } from '@constants/chat';

const useInitialiseNewChat = () => React.useCallback(() => {
  const state = useStore.getState();
  if (state.chats?.length) state.removeChats({ chatIds: state.chats.map(chat => chat.id) });
  else {
    state.setChats([generateDefaultChat()]);
    state.setCurrentChatIndex(0);
  }
}, []);

export default useInitialiseNewChat;
