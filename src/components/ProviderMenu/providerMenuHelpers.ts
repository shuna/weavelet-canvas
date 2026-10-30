import { useCallback, useEffect, useRef, useState } from 'react';
import { validateLanProvider } from '@utils/lanProvider';
import { fetchProviderModels } from '@api/providerModels';
import useStore from '@store/store';
import { ProviderConfig, ProviderId, ProviderModel } from '@type/provider';

export type SortField = 'alpha' | 'created' | 'context' | 'price';
export type SortDir = 'asc' | 'desc';
export type ProviderModelMap = Partial<Record<ProviderId, ProviderModel[]>>;
export type ProviderLoadingMap = Partial<Record<ProviderId, boolean>>;

export const hasLoadedProviderModels = (
  models: ProviderModelMap,
  providerId: ProviderId
) => Object.prototype.hasOwnProperty.call(models, providerId);

export const formatUsd = (value: number): string => {
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
};

export const formatModelPrice = (
  prompt?: number,
  completion?: number
): string => {
  if (prompt == null) return '-';
  if (prompt === 0 && (completion == null || completion === 0)) return 'Free';
  return `${formatUsd(prompt)} / ${completion != null ? formatUsd(completion) : '-'}`;
};

export const sortModels = (
  models: ProviderModel[],
  search: string,
  sortField: SortField,
  sortDir: SortDir
) => {
  return models
    .filter((model) => {
      if (!search) return true;
      const query = search.toLowerCase();
      return (
        model.id.toLowerCase().includes(query) ||
        model.name.toLowerCase().includes(query)
      );
    })
    .sort((left, right) => {
      let comparison = 0;

      switch (sortField) {
        case 'alpha':
          comparison = left.name.localeCompare(right.name);
          break;
        case 'created':
          comparison = (left.created || 0) - (right.created || 0);
          break;
        case 'context':
          comparison = (left.contextLength || 0) - (right.contextLength || 0);
          break;
        case 'price': {
          const leftPrompt =
            left.promptPrice != null && left.promptPrice >= 0
              ? left.promptPrice
              : Infinity;
          const rightPrompt =
            right.promptPrice != null && right.promptPrice >= 0
              ? right.promptPrice
              : Infinity;
          comparison = leftPrompt - rightPrompt;
          break;
        }
      }

      return sortDir === 'asc' ? comparison : -comparison;
    });
};

export const useProviderModels = (providers: Record<ProviderId, ProviderConfig>, selectedProvider?: ProviderId) => {
  const cachedModels = useStore((state) => state.providerModelCache);
  const setProviderModelCache = useStore((state) => state.setProviderModelCache);
  const [models, setModels] = useState<ProviderModelMap>(() => ({ ...cachedModels }));
  const [errors, setErrors] = useState<Partial<Record<ProviderId, string>>>({});
  const requests = useRef(new Map<ProviderId, AbortController>());
  useEffect(() => () => { for (const controller of requests.current.values()) controller.abort(); }, []);
  const [loading, setLoading] = useState<ProviderLoadingMap>({});

  useEffect(() => {
    requests.current.get('lan')?.abort();
    setErrors(previous => ({ ...previous, lan: undefined }));
    setLoading(previous => ({ ...previous, lan: false }));
  }, [providers.lan]);

  // Sync local state when Zustand cache changes (e.g. cleared on endpoint/apiKey change)
  useEffect(() => {
    setModels((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next) as ProviderId[]) {
        if (!cachedModels[key]) {
          delete next[key];
          changed = true;
        }
      }
      for (const key of Object.keys(cachedModels) as ProviderId[]) {
        if (cachedModels[key] && cachedModels[key] !== prev[key]) {
          next[key] = cachedModels[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cachedModels]);

  const setProviderLoading = (providerId: ProviderId, isLoading: boolean) => {
    setLoading((previous) => ({ ...previous, [providerId]: isLoading }));
  };

  const updateModels = (providerId: ProviderId, result: ProviderModel[]) => {
    setModels((previous) => ({ ...previous, [providerId]: result }));
    setProviderModelCache(providerId, result);
  };

  const loadModels = useCallback(
    async (providerId: ProviderId, force = false) => {
      if (providerId === 'lan' && !force) return;
      if (!force && hasLoadedProviderModels(models, providerId)) {
        return;
      }

      setProviderLoading(providerId, true);
      try {
        const result = await fetchProviderModels(providers[providerId]);
        updateModels(providerId, result);
      } finally {
        setProviderLoading(providerId, false);
      }
    },
    [models, providers]
  );

  const refreshModels = useCallback(
    async (providerId: ProviderId, providerConfig: ProviderConfig) => {
      requests.current.get(providerId)?.abort();
      const controller = new AbortController();
      requests.current.set(providerId, controller);
      const signature = JSON.stringify(providerConfig);
      const current = () => !controller.signal.aborted && signature === JSON.stringify(useStore.getState().providers[providerId]);
      setProviderLoading(providerId, true);
      setErrors(previous => ({ ...previous, [providerId]: undefined }));
      try {
        const result = await fetchProviderModels(providerConfig, controller.signal);
        if (current()) updateModels(providerId, result);
      } catch (error) {
        if (current()) setErrors(previous => ({ ...previous, [providerId]: error instanceof Error ? error.message : 'Model listing failed' }));
      } finally {
        if (requests.current.get(providerId) === controller) {
          requests.current.delete(providerId);
          setProviderLoading(providerId, false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (selectedProvider !== 'lan') return;
    try {
      const provider = validateLanProvider(providers.lan);
      if (provider.endpoint && provider.modelsEndpoint) void refreshModels('lan', providers.lan);
    } catch { /* Incomplete saved settings must not trigger a request. */ }
  }, [selectedProvider, providers.lan, refreshModels]);

  return {
    errors,
    models,
    loading,
    loadModels,
    refreshModels,
  };
};
