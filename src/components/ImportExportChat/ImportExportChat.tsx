import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import ExportIcon from '@icon/ExportIcon';
import PopupModal from '@components/PopupModal';

import ImportChat from './ImportChat';
import ExportChat from './ExportChat';

const ImportExportChat = () => {
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  return (
    <>
      <a
        className='flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-gray-700 transition-colors duration-200 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-500/10'
        onClick={() => {
          setIsModalOpen(true);
        }}
      >
        <ExportIcon className='w-4 h-4 shrink-0' />
        <span className='min-w-0 truncate' title={`${t('import')} / ${t('export')}`}>
          {t('import')} / {t('export')}
        </span>
      </a>
      {isModalOpen && (
        <PopupModal
          title={`${t('import')} / ${t('export')}`}
          setIsModalOpen={setIsModalOpen}
          cancelButton={false}
        >
          <div className='p-5 w-[85vw] max-w-xl'>
            <ImportChat />
            <details className='mt-4 border-t border-gray-200 pt-4 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300'>
              <summary className='cursor-pointer'>{t('export')} (JSON)</summary>
              <div className='mt-3'><ExportChat hideTitle /></div>
            </details>
          </div>
        </PopupModal>
      )}
    </>
  );
};

export default ImportExportChat;
