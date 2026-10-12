import { useWorkspaceStore, useWorkspaceReadOnly } from '@store/workspaceScope';

const useAddChat = () => {
  const useStore = useWorkspaceStore();
  const readOnly = useWorkspaceReadOnly();
  const createChat = useStore(state => state.createChat);
  return (folderId?: string) => readOnly ? { status: 'not-ready' as const } : createChat({ folderId });
};

export default useAddChat;
