import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '@store/store';
import PopupModal from '@components/PopupModal';

import TickIcon from '@icon/TickIcon';

const CloneChat = React.memo(() => {
  const { t } = useTranslation();

  const [cloned, setCloned] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [visibleBranchOnly, setVisibleBranchOnly] = useState<boolean>(false);

  const cloneChat = () => {
    const state = useStore.getState();
    const chatId = state.chats?.[state.currentChatIndex]?.id;
    if (!chatId || state.duplicateChat({ chatId, scope: visibleBranchOnly ? 'activePath' : 'all' }).status !== 'created') return;
    setIsModalOpen(false);
    setCloned(true);
    window.setTimeout(() => setCloned(false), 3000);
  };

  return (
    <>
      <button
        className='btn btn-neutral flex gap-1'
        aria-label={t('cloneChat') as string}
        onClick={() => {
          setIsModalOpen(true);
        }}
      >
        {cloned ? (
          <>
            <TickIcon /> {t('cloned')}
          </>
        ) : (
          <>{t('cloneChat')}</>
        )}
      </button>
      {isModalOpen && (
        <PopupModal
          setIsModalOpen={setIsModalOpen}
          title={t('cloneChat') as string}
          handleConfirm={cloneChat}
        >
          <div className='p-6 border-b border-gray-200 dark:border-gray-600'>
            <label className='flex items-center gap-2 text-sm text-gray-900 dark:text-gray-300 cursor-pointer'>
              <input
                type='checkbox'
                checked={visibleBranchOnly}
                onChange={(e) => setVisibleBranchOnly(e.target.checked)}
                className='rounded'
              />
              {t('exportVisibleBranchOnly')}
            </label>
          </div>
        </PopupModal>
      )}
    </>
  );
});

export default CloneChat;
