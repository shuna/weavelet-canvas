import { ResetButton } from '@components/ConfigMenu/fields';
import { useState } from 'react';
import PopupModal from '@components/PopupModal';
import ConfigMenu from '@components/ConfigMenu';
import useStore from '@store/store';
import { _defaultChatConfig } from '@constants/chat';
import { isLocalModelConfig } from '@hooks/submitHelpers';
import type { ConfigInterface } from '@type/chat';

export function SummarySettingsFields({ config, disabled = false }: { config: ConfigInterface; disabled?: boolean }) {
  const summaryConfig = useStore(state => state.bubbleSummaryConfig);
  const generationConfig = summaryConfig ?? config;
  const local = isLocalModelConfig(generationConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return <>
      <fieldset disabled={disabled} className='min-w-0 space-y-2'>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-2' role='radiogroup' aria-label='生成モデル'>
          <span className='whitespace-nowrap'>生成モデル:</span>
          <label className='flex items-center gap-1 whitespace-nowrap'><input type='radio' name='summary-model-mode' className='accent-blue-600' checked={!summaryConfig} onChange={() => useStore.getState().setBubbleSummaryConfig(undefined)} />デフォルト</label>
          <label className='flex items-center gap-1 whitespace-nowrap'><input type='radio' name='summary-model-mode' className='accent-blue-600' checked={!!summaryConfig} onChange={() => useStore.getState().setBubbleSummaryConfig({ ...(local ? _defaultChatConfig : config) })} />カスタム</label>
          <ResetButton visible={!!summaryConfig} disabled={disabled} onClick={() => useStore.getState().setBubbleSummaryConfig(undefined)} />
        </div>
        <p className='break-all text-xs'>{summaryConfig ? 'カスタム' : 'デフォルト'}: {generationConfig.model} · {generationConfig.providerId ?? '既定のAPI'} · 温度 {generationConfig.temperature} · 出力上限 {generationConfig.max_tokens || 'モデル既定'} · 思考 {generationConfig.reasoning_effort ?? 'モデル既定'}</p>
        <button type='button' disabled={disabled || !summaryConfig} className='btn btn-neutral disabled:cursor-not-allowed disabled:opacity-50' onClick={() => setSettingsOpen(true)}>モデル・生成パラメータを調整</button>
      </fieldset>
    {settingsOpen && <ConfigMenu auxiliary config={generationConfig} setConfig={useStore.getState().setBubbleSummaryConfig} imageDetail='auto' setImageDetail={() => {}} setIsModalOpen={setSettingsOpen} />}
  </>;
}
export default function SummarySettings({ config, setOpen }: { config: ConfigInterface; setOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  return <PopupModal title='要約・圧縮設定' setIsModalOpen={setOpen}><div className='p-5 text-sm text-gray-900 dark:text-gray-300'><SummarySettingsFields config={config} /></div></PopupModal>;
}
