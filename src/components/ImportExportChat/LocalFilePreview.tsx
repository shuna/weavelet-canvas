import React, { useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useTranslation } from 'react-i18next';
import Chat from '@components/Chat';
import Menu from '@components/Menu';
import { createPreviewStore, WorkspaceContext } from '@store/workspaceScope';
import { ImportPreviewSource, importSelectedPreview, retryImportPreviewSave } from './importService';

export const useImportPreviewSession = create<{ source: ImportPreviewSource | null; fileName: string }>(() => ({ source: null, fileName: '' }));
export default function LocalFilePreview({ source, fileName }: { source: ImportPreviewSource; fileName: string }) {
  const { t } = useTranslation('import');
  const [store] = useState(() => createPreviewStore(source));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [summaryTabs, setSummaryTabs] = useState<Record<string, 'original' | 'summary' | 'compact'>>({});
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [error, setError] = useState('');
  const bar = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const update = () => shell.current?.style.setProperty('--preview-bar-height', `${bar.current?.offsetHeight ?? 48}px`);
    update();
    const observer = new ResizeObserver(update);
    if (bar.current) observer.observe(bar.current);
    return () => observer.disconnect();
  }, []);
  const close = () => useImportPreviewSession.setState({ source: null, fileName: '' });
  const commit = async () => {
    setBusy(true); setError('');
    try {
      const result = pendingSave
        ? await retryImportPreviewSave((key, options) => String(t(key, options as any)))
        : await importSelectedPreview(source, selectedIds, (key, options) => String(t(key, options as any)), { fileName, selectedFolderIds });
      if (result.success) close();
      else { setError(result.message); if (result.status === 'storage-error') setPendingSave(true); }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <WorkspaceContext.Provider value={{ store, readOnly: true, selectedIds, setSelectedIds, selectedFolderIds, setSelectedFolderIds, summaryTabs, setSummaryTab: (key, tab) => setSummaryTabs(previous => ({ ...previous, [key]: tab })) }}>
    <div ref={shell} className='relative flex h-full flex-col overflow-hidden' style={{ '--preview-bar-height': '48px' } as React.CSSProperties}>
      <div ref={bar} role='region' aria-label='Local file preview' className='relative z-[1100] shrink-0 flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100'>
        <span role='status'>{t('preview.readOnly', '閲覧専用')}</span>
        <span className='min-w-0 flex-1 truncate' title={fileName}>{fileName}</span>
        <button type='button' aria-label='Select all preview items' className='btn btn-small btn-neutral' disabled={busy || pendingSave} onClick={() => { setSelectedIds(source.chats.map(chat => chat.id)); setSelectedFolderIds(Object.keys(source.folders)); }}>{t('preview.selectAll', 'すべて選択')}</button>
        <button type='button' aria-label='Clear preview selection' className='btn btn-small btn-neutral' disabled={busy || pendingSave} onClick={() => { setSelectedIds([]); setSelectedFolderIds([]); }}>{t('preview.clearSelection', '選択解除')}</button>
        <span>{t('preview.selectionCount', { chats: selectedIds.length, folders: selectedFolderIds.length, defaultValue: 'チャット {{chats}} 件・フォルダ {{folders}} 件' })}</span>
        <button type='button' aria-label={pendingSave ? 'Retry saving imported chats' : 'Import selected chats'} className='btn btn-small btn-primary' disabled={busy || (!pendingSave && !selectedIds.length && !selectedFolderIds.length)} onClick={commit}>{pendingSave ? t('preview.retrySave', '保存を再試行') : t('preview.importSelection', '選択項目を取り込む')}</button>
        <button type='button' aria-label='Cancel preview' className='btn btn-small btn-neutral' disabled={busy} onClick={close}>{t('preview.cancel', 'キャンセル')}</button>
        {!!source.recoveredContentCount && <p role='status' className='w-full'>{t('preview.recoveredContent', { count: source.recoveredContentCount })}</p>}
        {!!Object.keys(source.unavailableContent ?? {}).length && <p role='status' className='w-full text-amber-800 dark:text-amber-200'>{t('preview.unavailableContent', { count: Object.keys(source.unavailableContent ?? {}).length })} {source.chats.filter(chat => source.unavailableContent?.[chat.id]?.length).map(chat => chat.title).join('、')}</p>}
        {error && <p role='alert' className='w-full whitespace-pre-wrap text-red-600'>{pendingSave ? t('preview.pendingSave', '取り込みは完了しましたが、保存に失敗しました。保存だけを再試行できます。') : ''} {error}</p>}
      </div>
      <Menu />
      <div className='min-h-0 flex-1'><Chat /></div>
    </div>
  </WorkspaceContext.Provider>;
}
