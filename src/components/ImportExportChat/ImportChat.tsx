import DriveImport from './DriveImport';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '@utils/showToast';
import { ImportMode, importChatFromFile, prepareImportPreview } from './importService';
import { useImportPreviewSession } from './LocalFilePreview';

const ImportChat = ({ hideTitle }: { hideTitle?: boolean }) => {
  const { t } = useTranslation(['main', 'import']);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>('append');
  const [file, setFile] = useState<File>();
  const fileSelected = !!file;
  const [browsing, setBrowsing] = useState(false);
  const browse = async () => {
    if (!file || browsing) return;
    setBrowsing(true);
    try { const source = await prepareImportPreview(file, translate); useImportPreviewSession.setState({ source, fileName: file.name }); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), "error", 15000); }
    finally { setBrowsing(false); }
  };
  const [includeSettings, setIncludeSettings] = useState(false);
  const [alert, setAlert] = useState<{
    message: string;
    success: boolean;
  } | null>(null);
  const translate = (key: string, opts?: Record<string, unknown>) =>
    String(t(key, opts as any) ?? '');

  const handleFileUpload = () => {
    if (!inputRef || !inputRef.current) return;
    const file = inputRef.current.files?.[0];
    if (!file) return;
    const confirmKey = includeSettings ? 'confirmReplaceAllWithSettings' : 'confirmReplaceAll';
    const replaceConfirmation = translate(confirmKey, {
      ns: 'import',
      defaultValue: 'Replace all existing chats with the imported file?',
    });

    if (
      mode === 'replace' &&
      !window.confirm(replaceConfirmation)
    ) {
      return;
    }

    importChatFromFile(file, translate, mode, mode === 'replace' ? includeSettings : true).then((result) => {
      if (result.success) {
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error', 15000);
      }
      setAlert({ message: result.message, success: result.success });
    });
  };

  return (
    <>
      {!hideTitle && (
        <div className='block mb-2 text-sm font-medium text-gray-900 dark:text-gray-300'>
          {t('import')} (JSON / .wvlt)
        </div>
      )}
      {/* Native <label> trigger — avoids Chrome user-activation issues
         with programmatic .click() inside stopPropagation portals */}
      <div className='flex items-center gap-3 rounded-lg bg-gray-100 p-3 dark:bg-gray-800/50'>
        <label
          className='btn btn-small btn-neutral flex items-center gap-2 whitespace-nowrap cursor-pointer focus-within:ring-2 focus-within:ring-blue-500'
        >
          <input
            className='absolute w-0 h-0 overflow-hidden opacity-0'
            type='file'
            accept='.json,.json.gz,.gz,.wvlt'
            ref={inputRef}
            onChange={() => setFile(inputRef.current?.files?.[0])}
          />
          {t('selectFile')}
        </label>
        <span className='min-w-0 flex-1 truncate text-sm text-gray-600 dark:text-gray-300' title={file?.name}>{file?.name}</span>
      </div>
      <button type='button' aria-label='Browse import file' className='btn btn-small btn-primary mt-4 w-full justify-center' disabled={!fileSelected || browsing} onClick={browse}>{t('preview.browse', { ns: 'import', defaultValue: '内容を確認して取り込む' })}</button>
      <details className='mt-5 border-t border-gray-200 pt-4 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300'>
        <summary className='cursor-pointer'>{t('importEntireFile', { ns: 'import' })}</summary>
        <div className='mt-3 flex flex-col gap-2 text-xs text-gray-500 dark:text-gray-400'>
          <label className='flex items-center gap-1.5 cursor-pointer'>
            <input
              type='radio'
              name='importMode'
              checked={mode === 'append'}
              onChange={() => setMode('append')}
              className='rounded'
            />
            {t('mode.append', { ns: 'import' })}
          </label>
          <label className='flex items-center gap-1.5 cursor-pointer'>
            <input
              type='radio'
              name='importMode'
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
              className='rounded'
            />
            {t('mode.replace', { ns: 'import' })}
          </label>
          {mode === 'replace' && (
            <>
              <div className='rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-200'>
                {t(includeSettings ? 'replaceWarningWithSettings' : 'replaceWarning', { ns: 'import' })}
              </div>
              <label className='flex items-center gap-1.5 cursor-pointer mt-1'>
                <input
                  type='checkbox'
                  checked={includeSettings}
                  onChange={() => setIncludeSettings((v) => !v)}
                  className='rounded'
                />
                {t('includeSettings', { ns: 'import' })}
              </label>
            </>
          )}
        </div>
        <button
          className={`btn btn-small mt-3 w-full justify-center ${fileSelected ? 'btn-primary' : 'btn-neutral cursor-not-allowed opacity-50'}`}
          onClick={handleFileUpload}
          disabled={!fileSelected}
          aria-label={translate('import')}
        >
          {t('import')}
        </button>
      </details>
      <DriveImport file={file} />
      {alert && (
        <div
          className={`relative py-2 px-3 w-full mt-3 border rounded-md text-gray-600 dark:text-gray-100 text-sm whitespace-pre-wrap ${
            alert.success
              ? 'border-green-500 bg-green-500/10'
              : 'border-red-500 bg-red-500/10'
          }`}
        >
          {alert.message}
        </div>
      )}
    </>
  );
};

export default ImportChat;
