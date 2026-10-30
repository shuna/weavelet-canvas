import { v4 as uuidv4 } from 'uuid';
const STORAGE_KEY = 'weavelet-device-id';

export const getOrCreateDeviceId = (): string => {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = uuidv4();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return uuidv4();
  }
};
