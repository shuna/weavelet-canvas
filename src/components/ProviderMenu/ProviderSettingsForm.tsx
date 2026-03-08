import React from 'react';
import { useTranslation } from 'react-i18next';

import { ProviderConfig, ProviderId } from '@type/provider';

export default function ProviderSettingsForm({
  selectedProvider,
  providers,
  endpointInput,
  apiVersionInput,
  apiKeyInput,
  onEndpointChange,
  onApiVersionChange,
  onApiKeyChange,
  onSave,
}: {
  selectedProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  endpointInput: string;
  apiVersionInput: string;
  apiKeyInput: string;
  onEndpointChange: (value: string) => void;
  onApiVersionChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation('model');

  return (
    <div className='p-3 border-t dark:border-gray-600 flex flex-col gap-2'>
      <div className='flex flex-col md:flex-row md:items-center gap-1 md:gap-2'>
        <label className='text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap md:w-24'>
          {t('provider.endpointLabel', 'Endpoint:')}
        </label>
        <input
          type='text'
          value={endpointInput}
          onChange={(event) => onEndpointChange(event.target.value)}
          placeholder={t('provider.enterEndpoint', 'API endpoint URL') as string}
          className='flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
        />
      </div>

      {selectedProvider === 'openai' && (
        <div className='flex flex-col md:flex-row md:items-center gap-1 md:gap-2'>
          <label className='text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap md:w-24'>
            {t('provider.apiVersionLabel', 'API Version:')}
          </label>
          <input
            type='text'
            value={apiVersionInput}
            onChange={(event) => onApiVersionChange(event.target.value)}
            placeholder={t('provider.apiVersionPlaceholder', 'e.g. 2023-07-01-preview (Azure)') as string}
            className='flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
          />
        </div>
      )}

      <div className='flex flex-col md:flex-row md:items-center gap-1 md:gap-2'>
        <label className='text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap md:w-24'>
          {t('provider.apiKeyLabel', 'API Key:')}
        </label>
        <div className='flex gap-2 flex-1'>
          <input
            type='password'
            value={apiKeyInput}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={
              t('provider.enterApiKey', 'Enter API key for {{name}}...', {
                name: providers[selectedProvider]?.name || selectedProvider,
              }) as string
            }
            className='flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
          />
          <button onClick={onSave} className='btn btn-primary text-sm px-4 py-2'>
            {t('provider.save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
