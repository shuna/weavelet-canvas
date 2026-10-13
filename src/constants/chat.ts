import { v4 as uuidv4 } from 'uuid';
import {
  ChatInterface,
  TextContentInterface,
} from '@type/chat';
import useStore from '@store/store';
import { normalizeConfigStream } from '@utils/streamSupport';
import { createLibraryChat } from '@utils/chatLibrary';
import { defaultSystemMessage } from './chatDefaults';
import { newChatDefaults } from '@utils/newChatDefaults';

const date = new Date();
const dateString =
  date.getFullYear() +
  '-' +
  ('0' + (date.getMonth() + 1)).slice(-2) +
  '-' +
  ('0' + date.getDate()).slice(-2);

// Environment overrides belong to the Web host; initial values are shared with native.
export { defaultModel, defaultUserMaxToken, _defaultChatConfig, _defaultImageDetail } from './chatDefaults';
export const _defaultSystemMessage = import.meta.env.VITE_DEFAULT_SYSTEM_MESSAGE ?? defaultSystemMessage;
export const defaultApiVersion = '2024-04-01-preview';
export const reduceMessagesToTotalToken = 256000; // sufficient for almost all models; gemini has 1.5kk though

export const generateDefaultChat = (
  title?: string,
  folder?: string
): ChatInterface => {
  const state = useStore.getState();
  const defaults = newChatDefaults(state);
  const chat = createLibraryChat(uuidv4(), title, defaults.defaultChatConfig,
    defaults.defaultImageDetail, defaults.defaultSystemMessage, folder);
  chat.config = normalizeConfigStream(chat.config);
  return chat;
};

export { codeLanguageSubset } from './markdown';

export const _defaultMenuWidth = 260;
export const _defaultDisplayChatSize = false;
