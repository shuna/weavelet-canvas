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
      <fieldset disabled={disabled} className='space-y-2 rounded border border-gray-200 p-3 dark:border-gray-600'>
        <legend className='px-1'>要約の生成設定</legend>
        <div className='flex items-center gap-2'><label className='flex items-center gap-2'><input type='checkbox' checked={!!summaryConfig} onChange={event => useStore.getState().setBubbleSummaryConfig(event.target.checked ? { ...(local ? _defaultChatConfig : config) } : undefined)} />要約専用のモデル・設定を使う（全チャット共通）</label><ResetButton visible={!!summaryConfig} disabled={disabled} onClick={() => useStore.getState().setBubbleSummaryConfig(undefined)} /></div>
        <p className='break-all text-xs'>{summaryConfig ? '要約専用' : 'チャット設定を使用'}: {generationConfig.model} · {generationConfig.providerId ?? '既定のAPI'} · 温度 {generationConfig.temperature} · 出力上限 {generationConfig.max_tokens || 'モデル既定'} · 思考 {generationConfig.reasoning_effort ?? 'モデル既定'}</p>
        {summaryConfig && <button type='button' className='btn btn-neutral' onClick={() => setSettingsOpen(true)}>モデル・生成パラメータを調整</button>}
        <button type='button' className='btn btn-neutral' disabled={!summaryConfig} onClick={() => useStore.getState().setBubbleSummaryConfig(undefined)}>デフォルトにリセット</button>
      </fieldset>
    {settingsOpen && <ConfigMenu auxiliary config={generationConfig} setConfig={useStore.getState().setBubbleSummaryConfig} imageDetail='auto' setImageDetail={() => {}} setIsModalOpen={setSettingsOpen} />}
  </>;
}
export default function SummarySettings({ config, setOpen }: { config: ConfigInterface; setOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  return <PopupModal title='要約・圧縮設定' setIsModalOpen={setOpen}><div className='p-5 text-sm text-gray-900 dark:text-gray-300'><SummarySettingsFields config={config} /></div></PopupModal>;
}
