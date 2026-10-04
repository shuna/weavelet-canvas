import React from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '@store/store';
import { baseButtonClass } from './ChatContent/ScrollToBottomButton';

const UndoRedoButtons = () => {
  const { t } = useTranslation();
  const canUndo = useStore((state) => state.canUndoBranch());
  const canRedo = useStore((state) => state.canRedoBranch());
  const undo = useStore((state) => state.undoBranch);
  const redo = useStore((state) => state.redoBranch);

  return (
    <>
      <button className={baseButtonClass} onClick={undo} disabled={!canUndo} aria-label='Undo' title={String(t('branchEditorMenu.undo'))}>
        <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
          <path d='M3 10h13a4 4 0 0 1 0 8H7M3 10l4-4M3 10l4 4' />
        </svg>
      </button>
      <button className={baseButtonClass} onClick={redo} disabled={!canRedo} aria-label='Redo' title={String(t('branchEditorMenu.redo'))}>
        <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
          <path d='M21 10H8a4 4 0 0 0 0 8h10M21 10l-4-4M21 10l-4 4' />
        </svg>
      </button>
    </>
  );
};

export default UndoRedoButtons;
