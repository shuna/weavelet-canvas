import { useTranslation } from 'react-i18next';
import useStore from '@store/store';
import type { ConfigInterface, ModelSettings } from '@type/chat';
import { commonModelRevision, commonModelSettings, pickModelSettings } from '@utils/modelSettings';
import { getModelContextInfo, getModelOutputLimit } from '@utils/modelLookup';
import { getMaxCompletionTokensForContext } from '@utils/tokenBudget';
import { InfoTooltip } from './fields';

const fieldLabels: Record<keyof ModelSettings, string> = {
  max_tokens: 'token.label', temperature: 'temperature.label', top_p: 'topP.label',
  presence_penalty: 'presencePenalty.label', frequency_penalty: 'frequencyPenalty.label',
  stream: 'stream.label', reasoning_effort: 'reasoningEffort.label', reasoning_budget_tokens: 'reasoningBudget.label',
  force_reasoning: 'forceReasoning.label', verbosity: 'verbosity.label', openRouter: 'openRouter.title',
};

export default function ModelUpdateNotice({ config, onReview, onApply }: {
  config: ConfigInterface;
  onReview: (revision: string) => void;
  onApply: (settings: ModelSettings, revision: string) => void;
}) {
  const { t } = useTranslation('model');
  useStore(state => state.providerCustomModels);
  useStore(state => state.providerModelCache);
  useStore(state => state.favoriteModels);
  useStore(state => state.defaultChatConfig);
  if (!config.model || !config.providerId || config.modelSource === 'local') return null;
  const revision = commonModelRevision(config);
  const common = commonModelSettings(config);
  const current = { ...pickModelSettings(config), stream: config.stream !== false,
    reasoning_effort: config.reasoning_effort ?? 'none', reasoning_budget_tokens: config.reasoning_budget_tokens ?? 0,
    force_reasoning: config.force_reasoning ?? false,
  };
  const differences = (Object.keys(common) as (keyof ModelSettings)[])
    .filter(key => JSON.stringify(current[key]) !== JSON.stringify(common[key]));
  const needsReview = config.modelReview !== revision;
  const context = getModelContextInfo(config.model, config.providerId);
  const outputLimit = getModelOutputLimit(config.model, config.providerId, config.modelSource);
  const exceedsLimit = (outputLimit !== undefined && config.max_tokens > outputLimit) || (!context.isFallback && config.max_tokens > getMaxCompletionTokensForContext(context.contextLength));
  return <div className='flex items-center justify-end gap-2 text-xs'>
    {(needsReview || differences.length > 0 || exceedsLimit) && <InfoTooltip warning text={<div className='space-y-2'>
      <p>{t(needsReview ? 'modelUpdate.unreviewed' : 'modelUpdate.different')}</p>
      {exceedsLimit && <p>{t('modelUpdate.exceedsLimit')}</p>}
      {!context.isFallback && <p>{t('modelUpdate.context', { count: context.contextLength })}</p>}
      {differences.map(key => <div key={key} className='break-words'>
        <strong>{t(fieldLabels[key], key)}</strong><div>{t('modelUpdate.values', { current: JSON.stringify(current[key]) ?? '—', common: JSON.stringify(common[key]) ?? '—' })}</div>
      </div>)}
      {needsReview && <button type='button' className='underline' onClick={() => onReview(revision)}>{t('modelUpdate.keep')}</button>}
    </div>} />}
    <button type='button' className='text-blue-600 dark:text-blue-400 underline' onClick={() => onApply(common, revision)}>{t('modelUpdate.replaceAll')}</button>
  </div>;
}
