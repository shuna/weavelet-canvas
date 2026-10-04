import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '@store/store';
import OmitIcon from '@icon/OmitIcon';
import ProtectedIcon from '@icon/ProtectedIcon';
import EvaluateIcon from '@icon/EvaluateIcon';
import { isSummaryEligible } from '@utils/bubbleSummary';
import BubbleSummaryControls from './BubbleSummaryControls';

const MetaActions = memo(
  ({
    messageIndex,
    isOmitted,
    isProtected,
    showEvaluateButton,
    onEvaluate,
  }: {
    messageIndex: number;
    isOmitted: boolean;
    isProtected: boolean;
    showEvaluateButton: boolean;
    onEvaluate: () => void;
  }) => {
    const { t } = useTranslation();
    const currentChatIndex = useStore((state) => state.currentChatIndex);
    const toggleOmitNode = useStore((state) => state.toggleOmitNode);
    const toggleProtectNode = useStore((state) => state.toggleProtectNode);
    const isSummaryTarget = useStore((state) => {
      const chat = state.chats?.[state.currentChatIndex];
      const nodeId = chat?.branchTree?.activePath[messageIndex] ?? String(messageIndex);
      return !!chat?.summaryTargets?.[nodeId];
    });
    const canSelectSummary = useStore(state => {
      const chat = state.chats?.[state.currentChatIndex];
      const id = chat?.branchTree?.activePath[messageIndex];
      return !isOmitted && !!chat && isSummaryEligible(chat.messages[messageIndex]) &&
        !Object.values(state.generatingSessions).some(session => session.chatId === chat.id && session.targetNodeId === id);
    });
    const toggleSummaryTarget = useStore((state) => state.toggleSummaryTarget);


    return (
      <div className='pointer-events-none flex items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100'>
        <div className='flex items-center gap-0.5 rounded-full bg-white/80 px-1.5 py-0.5 shadow-sm ring-1 ring-black/5 backdrop-blur-sm dark:bg-gray-800/80 dark:ring-white/10'>
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
              toggleOmitNode(currentChatIndex, messageIndex);
            }}
            title={String(isOmitted ? t('omitOff') : t('omitOn'))}
            aria-label={String(isOmitted ? t('omitOff') : t('omitOn'))}
          >
            <OmitIcon className='h-3.5 w-3.5' />
          </button>
          <button
            type='button'
            className={`rounded-full px-1 text-xs transition-colors ${isSummaryTarget ? 'text-violet-600 dark:text-violet-300' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500'}`}
            onClick={(e) => { e.stopPropagation(); toggleSummaryTarget(currentChatIndex, messageIndex); }}
            disabled={!isSummaryTarget && !canSelectSummary}
            aria-pressed={isSummaryTarget}
            title={isSummaryTarget ? '要約対象から外す' : '要約に含める'}
            aria-label={isSummaryTarget ? '要約対象から外す' : '要約に含める'}
          >要約</button>
          <BubbleSummaryControls messageIndex={messageIndex} />
          <button
            type='button'
            className={`rounded-full p-1 transition-colors ${
              isProtected
                ? 'text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300'
                : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              toggleProtectNode(currentChatIndex, messageIndex);
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
