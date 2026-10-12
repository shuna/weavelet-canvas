import React from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import useStore from '@store/store';

import NewFolderIcon from '@icon/NewFolderIcon';
import { applyFolderOperation } from '@utils/chatFolders';

const NewFolder = () => {
  const { t } = useTranslation();
  const setFolders = useStore((state) => state.setFolders);

  const addFolder = () => {
    const state = useStore.getState();
    setFolders(applyFolderOperation(state, { type: 'create', id: uuidv4() }).folders);
  };

  return (
    <a
      className='mb-2 flex flex-shrink-0 cursor-pointer items-center gap-3 rounded-md border border-gray-200 px-3 py-3 text-sm text-gray-700 opacity-100 transition-colors duration-200 hover:bg-gray-100 dark:border-white/20 dark:text-white dark:hover:bg-gray-500/10'
      onClick={() => {
        addFolder();
      }}
    >
      <NewFolderIcon />
    </a>
  );
};

export default NewFolder;
