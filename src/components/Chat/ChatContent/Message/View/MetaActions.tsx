import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '@store/store';
import OmitIcon from '@icon/OmitIcon';
import ProtectedIcon from '@icon/ProtectedIcon';
import EvaluateIcon from '@icon/EvaluateIcon';
import BubbleSummaryControls from './BubbleSummaryControls';
import { useBubbleSummaryJob } from './bubbleSummaryGeneration';

const MetaActions = memo(
  ({
    chatId,
    nodeId,
    isOmitted,
    isProtected,
    showEvaluateButton,
    onEvaluate,
  }: {
    chatId: string;
    nodeId: string;
    isOmitted: boolean;
    isProtected: boolean;
    showEvaluateButton: boolean;
    onEvaluate: () => void;
  }) => {
    const { t } = useTranslation();
    const setNodeOmitted = useStore((state) => state.setNodeOmitted);
    const setNodeProtected = useStore((state) => state.setNodeProtected);
    const job = useBubbleSummaryJob(chatId, nodeId);
    const messageIndex = useStore(state => {
      const chat = state.chats?.find(chat => chat.id === chatId);
      return chat?.branchTree ? chat.branchTree.activePath.indexOf(nodeId) : Number(nodeId);
    });

    return (
      <div className={`flex flex-wrap justify-end items-center gap-1 transition-opacity ${job?.busy || job?.error ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100'}`}>
        <BubbleSummaryControls messageIndex={messageIndex} />
        <div role='group' aria-label='バブル操作' className='flex shrink-0 items-center gap-0.5 rounded-full bg-white/80 px-1.5 py-0.5 shadow-sm ring-1 ring-black/5 backdrop-blur-sm dark:bg-gray-800/80 dark:ring-white/10'>
          {showEvaluateButton && (
            <button
              type='button'
              className='rounded-full p-1 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
              onClick={(e) => {
                e.stopPropagation();
                onEvaluate();
              }}
              title={String(t('evaluation.modalTitle'))}
              aria-label={String(t('evaluation.modalTitle'))}
            >
              <EvaluateIcon className='h-3.5 w-3.5' />
            </button>
          )}
          <button
            type='button'
            className={`rounded-full p-1 transition-colors ${
              isOmitted
                ? 'text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300'
                : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              setNodeOmitted({ chatId, nodeId, value: !isOmitted });
            }}
            title={String(isOmitted ? t('omitOff') : t('omitOn'))}
            aria-label={String(isOmitted ? t('omitOff') : t('omitOn'))}
          >
            <OmitIcon className='h-3.5 w-3.5' />
          </button>
          <button
            type='button'
            className={`rounded-full p-1 transition-colors ${
              isProtected
                ? 'text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300'
                : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              setNodeProtected({ chatId, nodeId, value: !isProtected });
            }}
            title={String(isProtected ? t('protectOff') : t('protectOn'))}
            aria-label={String(isProtected ? t('protectOff') : t('protectOn'))}
          >
            <ProtectedIcon className='h-3.5 w-3.5' />
          </button>
        </div>
      </div>
    );
  }
);

export default MetaActions;
