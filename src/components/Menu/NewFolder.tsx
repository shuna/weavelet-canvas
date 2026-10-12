import React from 'react';
import useStore from '@store/store';

import NewFolderIcon from '@icon/NewFolderIcon';

const NewFolder = () => {
  const addFolder = useStore(state => state.createFolder);

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
