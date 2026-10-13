import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '@store/workspaceScope';
import type { BranchTree } from '@type/chat';
import { branchDiff } from '@utils/branchDiff';
import PopupModal from '@components/PopupModal';

interface BranchDiffModalProps {
  chatIndex: number;
  pathA: string[];
  pathB: string[];
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const BranchDiffModal = ({
  chatIndex,
  pathA,
  pathB,
  setIsOpen,
}: BranchDiffModalProps) => {
  const useStore = useWorkspaceStore();

  const { t } = useTranslation();
  const tree = useStore(
    (state) => state.chats?.[chatIndex]?.branchTree
  ) as BranchTree;
  const contentStore = useStore((state) => state.contentStore);

  const {rows: diffRows, hasChanges} = useMemo(() =>
    branchDiff({tree, contentStore, pathA, pathB}), [pathA, pathB, tree, contentStore]);

  return (
    <PopupModal
      title={t('diffTitle') as string}
      setIsModalOpen={setIsOpen}
      handleConfirm={() => setIsOpen(false)}
    >
      <div className='max-h-[70vh] overflow-y-auto p-4'>
        {!hasChanges ? (
          <p className='text-gray-500 text-center'>{t('diffNoChanges')}</p>
        ) : (
          <div className='space-y-4'>
            {diffRows.map((row, idx) => (
              <div
                key={idx}
                className='border border-gray-200 dark:border-gray-700 rounded-lg p-3'
              >
                <span className='text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                  {row.role}
                </span>
                <div className='mt-1 text-sm leading-relaxed whitespace-pre-wrap'>
                  {row.segments.map((seg, si) => (
                    <span
                      key={si}
                      className={
                        seg.type === 'added'
                          ? 'bg-green-200 dark:bg-green-900/50 text-green-800 dark:text-green-200'
                          : seg.type === 'removed'
                          ? 'bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-200 line-through'
                          : ''
                      }
                    >
                      {seg.text}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PopupModal>
  );
};

export default BranchDiffModal;
