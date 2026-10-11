import useStore from '@store/store';

const useAddChat = () => {
  const createChat = useStore(state => state.createChat);
  return (folderId?: string) => createChat({ folderId });
};

export default useAddChat;
