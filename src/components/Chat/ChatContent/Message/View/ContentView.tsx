import React, {
  memo,
  useState,
} from 'react';

import useStore from '@store/store';

import useSubmit from '@hooks/useSubmit';

import {
  ContentInterface,
  ImageContentInterface,
  Role,
  isImageContent,
  isTextContent,
} from '@type/chat';
import {
  removeMessageWithBranchSync,
  resolveRegenerateTarget,
} from '@utils/branchUtils';
import ContentActions from './ContentActions';
import ContentAttachments from './ContentAttachments';
import ContentBody from './ContentBody';

const ContentView = memo(
  ({
    role,
    content,
    setIsEdit,
    messageIndex,
  }: {
    role: string;
    content: ContentInterface[];
    setIsEdit: React.Dispatch<React.SetStateAction<boolean>>;
    messageIndex: number;
  }) => {
    const { handleSubmit, handleSubmitMidChat } = useSubmit();

    const [isDelete, setIsDelete] = useState<boolean>(false);

    const currentChatIndex = useStore((state) => state.currentChatIndex);
    const setChats = useStore((state) => state.setChats);
    const nodeId = useStore(
      (state) =>
        state.chats?.[state.currentChatIndex]?.branchTree?.activePath?.[
          messageIndex
        ]
    );
    const lastMessageIndex = useStore((state) =>
      state.chats ? state.chats[state.currentChatIndex].messages.length - 1 : 0
    );
    const inlineLatex = useStore((state) => state.inlineLatex);
    const markdownMode = useStore((state) => state.markdownMode);
    const currentChatId = useStore((state) =>
      state.chats?.[state.currentChatIndex]?.id ?? ''
    );
    const isGeneratingMessage = useStore((state) =>
      role === 'assistant' &&
      Object.values(state.generatingSessions).some(
        (s) => s.chatId === currentChatId && s.messageIndex === messageIndex
      )
    );
    const isCurrentChatGenerating = useStore((state) =>
      Object.values(state.generatingSessions).some((s) => s.chatId === currentChatId)
    );

    const handleDelete = () => {
      const chats = useStore.getState().chats!;
      const contentStore = useStore.getState().contentStore;
      const updatedChats = chats.slice();
      updatedChats[currentChatIndex] = structuredClone(chats[currentChatIndex]);
      removeMessageWithBranchSync(updatedChats[currentChatIndex], messageIndex, contentStore);
      setChats(updatedChats);
    };

    const handleMove = (direction: 'up' | 'down') => {
      const chats = useStore.getState().chats!;
      const updatedChats = chats.slice();
      updatedChats[currentChatIndex] = structuredClone(chats[currentChatIndex]);
      const updatedMessages = updatedChats[currentChatIndex].messages;
      const temp = updatedMessages[messageIndex];
      if (direction === 'up') {
        updatedMessages[messageIndex] = updatedMessages[messageIndex - 1];
        updatedMessages[messageIndex - 1] = temp;
      } else {
        updatedMessages[messageIndex] = updatedMessages[messageIndex + 1];
        updatedMessages[messageIndex + 1] = temp;
      }
      setChats(updatedChats);
    };

    const handleMoveUp = () => {
      handleMove('up');
    };

    const handleMoveDown = () => {
      handleMove('down');
    };

    const handleRefresh = () => {
      if (isCurrentChatGenerating) return;

      const plan = resolveRegenerateTarget(
        role as Role,
        messageIndex,
        useStore.getState().chats![currentChatIndex].messages.length
      );
      if (!plan) return;

      const chats = useStore.getState().chats!;
      const contentStore = useStore.getState().contentStore;
      const updatedChats = chats.slice();
      updatedChats[currentChatIndex] = structuredClone(chats[currentChatIndex]);

      if (plan.removeIndex >= 0) {
        removeMessageWithBranchSync(updatedChats[currentChatIndex], plan.removeIndex, contentStore);
      }
      setChats(updatedChats);

      if (plan.submitMode === 'append') {
        handleSubmit();
      } else {
        handleSubmitMidChat(plan.insertIndex);
      }
    };

    const currentTextContent = isTextContent(content[0]) ? content[0].text : '';
    const handleCopy = () => {
      navigator.clipboard.writeText(currentTextContent);
    };
    const validImageContents = Array.isArray(content)
    ? (content.slice(1).filter(isImageContent) as ImageContentInterface[])
    : [];
    return (
      <>
        <ContentBody
          currentTextContent={currentTextContent}
          markdownMode={markdownMode}
          inlineLatex={inlineLatex}
          isGeneratingMessage={isGeneratingMessage}
        />
        <ContentAttachments images={validImageContents} />
        <ContentActions
          nodeId={nodeId}
          currentChatIndex={currentChatIndex}
          role={role}
          messageIndex={messageIndex}
          lastMessageIndex={lastMessageIndex}
          isDelete={isDelete}
          isCurrentChatGenerating={isCurrentChatGenerating}
          setIsEdit={setIsEdit}
          setIsDelete={setIsDelete}
          onRefresh={handleRefresh}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onCopy={handleCopy}
          onDelete={handleDelete}
        />
      </>
    );
  }
);

export default ContentView;
