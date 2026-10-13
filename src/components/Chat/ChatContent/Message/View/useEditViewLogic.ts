import { textValueOf, replaceTextValue } from '@utils/messageText';
import { resolveValidSummary } from '@utils/bubbleSummary';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import useStore from '@store/store';
import { useWorkspaceStore, useWorkspaceReadOnly } from '@store/workspaceScope';
import useSubmit from '@hooks/useSubmit';
import {
  ContentInterface,
  ImageContentInterface,
  TextContentInterface,
  isImageContent,
} from '@type/chat';
import { defaultModel } from '@constants/chat';
import { resolveChatModel, confirmChatModelFavorite } from '@utils/chatModelResolution';
import { hasMeaningfulContent } from '@utils/contentValidation';
import { enterSubmission } from '@utils/enterSubmission';
import { showToast } from '@utils/showToast';
import i18next from 'i18next';

function isChatBusy(): boolean {
  const state = useStore.getState();
  const chatId = state.chats?.[state.currentChatIndex]?.id ?? '';
  return Object.values(state.generatingSessions).some((s) => s.chatId === chatId);
}

function isNodeBusy(nodeId?: string): boolean {
  if (!nodeId) return false;
  const state = useStore.getState();
  const chat = state.chats?.[state.currentChatIndex];
  const chatId = chat?.id ?? '';
  return Object.values(state.generatingSessions).some(
    (s) => s.chatId === chatId && s.targetNodeId === nodeId
  );
}

function isNodeProtected(nodeId: string | undefined, messageIndex: number): boolean {
  const state = useStore.getState();
  const chatIndex = state.currentChatIndex;
  const chat = state.chats?.[chatIndex];
  const resolvedNodeId = nodeId ?? chat?.branchTree?.activePath?.[messageIndex] ?? String(messageIndex);
  const protectedNodes =
    state.protectedNodeMaps[String(chatIndex)] ?? chat?.protectedNodes ?? {};
  return protectedNodes[resolvedNodeId] ?? false;
}

function hasProtectedFollowingNodes(messageIndex: number): boolean {
  const state = useStore.getState();
  const chatIndex = state.currentChatIndex;
  const chat = state.chats?.[chatIndex];
  if (!chat) return false;
  const protectedNodes =
    state.protectedNodeMaps[String(chatIndex)] ?? chat.protectedNodes ?? {};
  if (!protectedNodes || Object.keys(protectedNodes).length === 0) return false;
  const totalMessages = chat.messages.length;
  for (let i = messageIndex + 1; i < totalMessages; i++) {
    const nid = chat.branchTree?.activePath?.[i] ?? String(i);
    if (protectedNodes[nid]) return true;
  }
  return false;
}

function resolveMessageIndex(chatId: string, nodeId: string | undefined, fallbackIndex: number): number {
  const chat = useStore.getState().chats?.find(chat => chat.id === chatId);
  if (!chat) return -1;
  if (!nodeId) return chat.messages[fallbackIndex] ? fallbackIndex : -1;
  if (chat.branchTree) return chat.branchTree.activePath.indexOf(nodeId);
  const index = Number(nodeId);
  return String(index) === nodeId && chat.messages[index] ? index : -1;
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

const editDraftCache = new Map<string, ContentInterface[]>();

const cloneContent = (content: ContentInterface[]): ContentInterface[] =>
  content.map((item) =>
    item.type === 'image_url'
      ? { ...item, image_url: { ...item.image_url } }
      : { ...item }
  );

const imageContentIndexAt = (
  content: ContentInterface[],
  imageIndex: number
): number => {
  let seen = 0;
  return content.findIndex((item) => {
    if (!isImageContent(item)) return false;
    if (seen === imageIndex) return true;
    seen += 1;
    return false;
  });
};

export function useEditViewLogic({
  content,
  setIsEdit,
  messageIndex,
  nodeId,
  sticky,
  editSessionKey,
  summaryId,
}: {
  content: ContentInterface[];
  setIsEdit: React.Dispatch<React.SetStateAction<boolean>>;
  messageIndex: number;
  nodeId?: string;
  sticky?: boolean;
  editSessionKey: string;
  summaryId?: string;
}) {
  const useStore = useWorkspaceStore();
  const readOnly = useWorkspaceReadOnly();
  const inputRole = useStore((state) => state.inputRole);
  const appendNode = useStore((state) => state.appendNode);
  const replaceNodeAndPrune = useStore((state) => state.replaceNodeAndPrune);
  const saveNode = useStore((state) => state.saveNode);
  const currentChatIndex = useStore((state) => state.currentChatIndex);
  const { model, providerId, modelSource } = useStore((state) => {
    const { chats, currentChatIndex: idx } = state;
    const config =
      chats && chats.length > 0 && idx >= 0 && idx < chats.length
        ? chats[idx].config
        : undefined;
    return {
      model: config?.model ?? defaultModel,
      providerId: config?.providerId,
      modelSource: config?.modelSource,
    };
  });
  const modelStatus = useStore((state) => resolveChatModel(state.currentChatIndex, state).status);
  const currentChatId = useStore((state) => state.chats?.[state.currentChatIndex]?.id ?? '');
  const isGeneratingMessage = useStore((state) =>
    !!nodeId &&
    Object.values(state.generatingSessions).some(
      (session) => session.chatId === currentChatId && session.targetNodeId === nodeId
    )
  );
  const modelValid = !!model && modelStatus !== 'unmatched' && modelStatus !== 'unspecified';

  const [_content, setContentState] = useState<ContentInterface[]>(
    () => cloneContent(readOnly ? content : editDraftCache.get(editSessionKey) ?? content)
  );
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [imageUrl, setImageUrl] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync _content with content prop when it changes and no draft exists.
  // This handles desync when a mid-chat insert causes activePath and
  // messagesLimited to temporarily diverge during async token limiting.
  useEffect(() => {
    if (readOnly) return;
    if (!editDraftCache.has(editSessionKey)) {
      setContentState(cloneContent(content));
    }
  }, [content, editSessionKey]);
  const _setContent = React.useCallback<React.Dispatch<React.SetStateAction<ContentInterface[]>>>(
    (value) => {
      setContentState((previous) => {
        const nextValue = typeof value === 'function' ? value(previous) : value;
        const cloned = cloneContent(nextValue);
        editDraftCache.set(editSessionKey, cloned);
        return cloned;
      });
    },
    [editSessionKey]
  );
  const clearDraft = React.useCallback(() => {
    editDraftCache.delete(editSessionKey);
  }, [editSessionKey]);

  const {
    handleSubmit,
    handleSubmitMidChat,
    isUnknownContextConfirmOpen,
    setIsUnknownContextConfirmOpen,
    unknownContextConfirmMessage,
    handleUnknownContextConfirm,
    handleUnknownContextCancel,
  } = useSubmit();

  const resetTextAreaHeight = () => {
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement> | KeyboardEvent) => {
    const nativeEvent = 'nativeEvent' in e ? e.nativeEvent : e;
    const isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|playbook|silk/i.test(
        navigator.userAgent
      );
    const action = enterSubmission({ key: e.key, isComposing: nativeEvent.isComposing === true,
      keyCode: nativeEvent.keyCode, isMobile, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
      enterToSubmit: useStore.getState().enterToSubmit, sticky });
    if (action === 'generate') {
      e.preventDefault();
      handleGenerate();
      resetTextAreaHeight();
    } else if (action === 'save') {
      handleSave();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chat = useStore.getState().chats![currentChatIndex];
    const files = e.target.files!;
    const newImageURLs = Array.from(files).map((file: Blob) =>
      URL.createObjectURL(file)
    );
    const newImages = await Promise.all(
      newImageURLs.map(async (url) => {
        const blob = await fetch(url).then((r) => r.blob());
        return {
          type: 'image_url',
          image_url: {
            detail: chat.imageDetail,
            url: await blobToBase64(blob),
          },
        } as ImageContentInterface;
      })
    );
    _setContent((prev) => [...prev, ...newImages]);
  };

  const handleImageUrlChange = () => {
    if (imageUrl.trim() === '') return;
    const chat = useStore.getState().chats![currentChatIndex];
    const newImage: ImageContentInterface = {
      type: 'image_url',
      image_url: { detail: chat.imageDetail, url: imageUrl },
    };
    _setContent((prev) => [...prev, newImage]);
    setImageUrl('');
  };

  const handleImageDetailChange = (index: number, detail: string) => {
    const updatedImages = [..._content];
    const imageContentIndex = imageContentIndexAt(updatedImages, index);
    const image = imageContentIndex >= 0 ? updatedImages[imageContentIndex] : undefined;
    if (!isImageContent(image)) return;
    image.image_url.detail = detail as ImageContentInterface['image_url']['detail'];
    _setContent(updatedImages);
  };

  const handleRemoveImage = (index: number) => {
    const updatedImages = [..._content];
    const imageContentIndex = imageContentIndexAt(updatedImages, index);
    if (imageContentIndex < 0) return;
    updatedImages.splice(imageContentIndex, 1);
    _setContent(updatedImages);
  };

  const editTarget = () => {
    const chat = useStore.getState().chats?.find(chat => chat.id === currentChatId);
    return { chatId: currentChatId, nodeId: nodeId ?? chat?.branchTree?.activePath[messageIndex] ?? String(messageIndex) };
  };

  const commitSummary = (removeCount = 0) => {
    const state = useStore.getState();
    const chat = state.chats?.find(chat => chat.id === currentChatId);
    const summary = chat?.summaries?.find(value => value.id === summaryId);
    if (!chat || !summary?.useForSubmit || !_content.every(value => value.type === 'text') || !hasMeaningfulContent(_content)) return false;
    const range = resolveValidSummary({ ...chat, omittedNodes: state.omittedNodeMaps[String(currentChatIndex)] ?? chat.omittedNodes }, summary, Object.values(state.generatingSessions).filter(session => session.chatId === chat.id).map(session => session.targetNodeId));
    if (!range || range.last !== resolveMessageIndex(currentChatId, nodeId, messageIndex)) return false;
    state.saveBubbleSummary(chat.id, { ...summary, text: _content.map(value => value.type === 'text' ? value.text : '').join('\n') });
    for (let index = range.last + removeCount; index > range.last; index--) {
      const targetNodeId = state.chats?.find(value => value.id === chat.id)?.branchTree?.activePath[index] ?? String(index);
      if (state.removeNode({ chatId: chat.id, nodeId: targetNodeId }).status !== 'updated') return false;
    }
    clearDraft();
    setIsEdit(false);
    return true;
  };

  const handleSave = () => {
    const hasSubmittableContent = hasMeaningfulContent(_content);
    if (sticky && !hasSubmittableContent) return;
    if (!sticky && isNodeBusy(nodeId)) return;
    if (!sticky && isNodeProtected(nodeId, messageIndex)) {
      showToast(i18next.t('protectedCannotEdit', { ns: 'main' }), 'warning');
      return;
    }
    if (resolveChatModel(currentChatIndex).status === 'available' && !confirmChatModelFavorite(currentChatIndex)) return;

    if (summaryId) { commitSummary(); return; }
    const resolvedMessageIndex = resolveMessageIndex(currentChatId, nodeId, messageIndex);

    if (sticky) {
      if (appendNode({ chatId: currentChatId, role: inputRole, content: _content }).status !== 'updated') return;
      _setContent([{ type: 'text', text: '' } as TextContentInterface]);
      clearDraft();
      resetTextAreaHeight();
    } else {
      const role = useStore.getState().chats?.find(chat => chat.id === currentChatId)?.messages[resolvedMessageIndex]?.role;
      if (!role) return;
      const result = saveNode({ ...editTarget(), role, content: _content });
      if (result.status !== 'updated' && result.status !== 'unchanged') return;
      clearDraft();
      setIsEdit(false);
    }
  };

  const handleBranchOnly = () => {
    if (summaryId || sticky || isNodeBusy(nodeId)) return;
    if (resolveChatModel(currentChatIndex).status === 'available' && !confirmChatModelFavorite(currentChatIndex)) return;
    const { chatId, nodeId: fromNodeId } = editTarget();
    if (useStore.getState().createBranch({ chatId, fromNodeId, content: _content }).status !== 'created') return;
    clearDraft();
    setIsEdit(false);
  };

  const handleBranchGenerate = () => {
    if (isChatBusy() || !modelValid || sticky || isNodeBusy(nodeId)) return;
    if (!confirmChatModelFavorite(currentChatIndex)) return;
    if (summaryId) {
      const chat = useStore.getState().chats?.[currentChatIndex];
      const anchor = nodeId ?? chat?.branchTree?.activePath[resolveMessageIndex(currentChatId, nodeId, messageIndex)];
      if (!anchor || !commitSummary()) return;
      useStore.getState().truncateActivePathAt(currentChatIndex, anchor);
      handleSubmit();
      return;
    }
    const { chatId, nodeId: fromNodeId } = editTarget();
    if (useStore.getState().createBranch({ chatId, fromNodeId, content: _content }).status !== 'created') return;
    clearDraft();
    setIsEdit(false);
    handleSubmit();
  };

  const handleGenerateNextOnly = () => {
    if (isChatBusy() || !modelValid) return;
    if (isNodeProtected(nodeId, messageIndex)) {
      showToast(i18next.t('protectedCannotEdit', { ns: 'main' }), 'warning');
      return;
    }
    const resolvedMessageIndex = resolveMessageIndex(currentChatId, nodeId, messageIndex);
    if (resolvedMessageIndex < 0) return;
    const nextIndex = resolvedMessageIndex + 1;
    const chats = useStore.getState().chats!;
    const removeCount = nextIndex < chats[currentChatIndex].messages.length ? 1 : 0;
    // Only block if the immediately next node is protected
    if (removeCount > 0) {
      const nextNodeId = chats[currentChatIndex].branchTree?.activePath?.[nextIndex] ?? String(nextIndex);
      if (isNodeProtected(nextNodeId, nextIndex)) {
        showToast(i18next.t('protectedCannotDelete', { ns: 'main' }), 'warning');
        return;
      }
    }
    if (!confirmChatModelFavorite(currentChatIndex)) return;
    if (summaryId) { if (commitSummary(removeCount)) handleSubmitMidChat(nextIndex); return; }
    if (useStore.getState().prepareContinueNode({ ...editTarget(), content: _content }).status !== 'updated') return;
    clearDraft();
    setIsEdit(false);
    handleSubmitMidChat(nextIndex);
  };

  const handleGenerate = () => {
    const hasSubmittableContent = hasMeaningfulContent(_content);
    if (isChatBusy() || !modelValid) return;
    if (sticky && !hasSubmittableContent) return;
    if (!sticky && isNodeProtected(nodeId, messageIndex)) {
      showToast(i18next.t('protectedCannotEdit', { ns: 'main' }), 'warning');
      return;
    }
    if (!confirmChatModelFavorite(currentChatIndex)) return;

    if (sticky) {
      if (hasSubmittableContent) {
        if (appendNode({ chatId: currentChatId, role: inputRole, content: _content }).status !== 'updated') return;
      }
      _setContent([{ type: 'text', text: '' } as TextContentInterface]);
      clearDraft();
      resetTextAreaHeight();
    } else {
      const resolvedMessageIndex = resolveMessageIndex(currentChatId, nodeId, messageIndex);
      if (resolvedMessageIndex < 0) return;
      const chats = useStore.getState().chats!;
      const removeCount = Math.max(
        0,
        chats[currentChatIndex].messages.length - (resolvedMessageIndex + 1)
      );
      if (removeCount > 0 && hasProtectedFollowingNodes(resolvedMessageIndex)) {
        showToast(i18next.t('protectedPruneStopped', { ns: 'main' }), 'warning');
        return;
      }
      if (summaryId) { if (commitSummary(removeCount)) handleSubmit(); return; }
      if (replaceNodeAndPrune({ ...editTarget(), role: chats[currentChatIndex].messages[resolvedMessageIndex].role, content: _content, removeCount }).status !== 'updated') return;
      clearDraft();
      setIsEdit(false);
    }
    handleSubmit();
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (summaryId) return;
    const items = e.clipboardData.items;
    const chat = useStore.getState().chats![currentChatIndex];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const base64Image = await blobToBase64(blob);
          const newImage: ImageContentInterface = {
            type: 'image_url',
            image_url: { detail: chat.imageDetail, url: base64Image },
          };
          _setContent((prev) => [...prev, newImage]);
        }
      }
    }
  };

  const textValue = textValueOf(_content);
  const setTextValue = React.useCallback((value: string) => {
    _setContent((prev) => replaceTextValue(prev, value));
  }, [_setContent]);

  useEffect(() => {
    if (readOnly) return;
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [textValue]);

  const handleUploadButtonClick = () => {
    (fileInputRef.current as HTMLInputElement)?.click();
  };

  const handleCancel = () => {
    clearDraft();
    setIsEdit(false);
  };

  const contentChanged = useMemo(() => {
    const normalize = (c: ContentInterface[]) =>
      c.filter((item) => !(item.type === 'text' && (item as TextContentInterface).text === ''));
    const a = normalize(_content);
    const b = normalize(content);
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i], bi = b[i];
      if (ai.type !== bi.type) return true;
      if (ai.type === 'text' && bi.type === 'text' &&
        (ai as TextContentInterface).text !== (bi as TextContentInterface).text) return true;
      if (ai.type === 'image_url' && bi.type === 'image_url' &&
        (ai as ImageContentInterface).image_url.url !== (bi as ImageContentInterface).image_url.url) return true;
    }
    return false;
  }, [_content, content]);

  return {
    model,
    providerId,
    modelValid,
    isGeneratingMessage,
    currentChatIndex,
    _content,
    textValue,
    setTextValue,
    contentChanged,
    _setContent,
    isModalOpen,
    setIsModalOpen,
    imageUrl,
    setImageUrl,
    textareaRef,
    fileInputRef,
    handleKeyDown,
    handleFileChange,
    handleImageUrlChange,
    handleImageDetailChange,
    handleRemoveImage,
    handleSave,
    handleBranchOnly,
    handleBranchGenerate,
    handleGenerateNextOnly,
    handleGenerate,
    generateBelowDisabled: !sticky && hasProtectedFollowingNodes(messageIndex),
    handleCancel,
    handlePaste,
    handleUploadButtonClick,
    isUnknownContextConfirmOpen,
    setIsUnknownContextConfirmOpen,
    unknownContextConfirmMessage,
    handleUnknownContextConfirm,
    handleUnknownContextCancel,
  };
}
