import { PROVIDER_ORDER } from '@store/provider-config';
import { FavoriteModel, ProviderConfig, ProviderId } from '@type/provider';

export default function ProviderSidebar({
  providers,
  favoriteModels,
  selectedProvider,
  onSelectProvider,
}: {
  providers: Record<ProviderId, ProviderConfig>;
  favoriteModels: FavoriteModel[];
  selectedProvider: ProviderId;
  onSelectProvider: (providerId: ProviderId) => void;
}) {
  return (
    <div className='w-48 border-r dark:border-gray-600 overflow-y-auto flex-shrink-0'>
      {PROVIDER_ORDER.map((providerId) => {
        const provider = providers[providerId];
        const favoriteCount = favoriteModels.filter(
          (favorite) => favorite.providerId === providerId
        ).length;

        return (
          <button
            key={providerId}
            onClick={() => onSelectProvider(providerId)}
            className={`w-full text-left px-4 py-3 text-sm flex items-center justify-between transition-colors ${
              selectedProvider === providerId
                ? 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white font-medium'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600/50'
            }`}
          >
            <span>{provider.name}</span>
            {favoriteCount > 0 && (
              <span className='text-xs bg-green-600 text-white rounded-full px-1.5 py-0.5 ml-1'>
                {favoriteCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
