import i18next from 'i18next';
import useStore from '@store/store';
import type { ConfigInterface, OpenRouterChatSettings } from '@type/chat';
import { isOpenRouterURL, hardOpenRouterConstraints, applyOpenRouterControls as applyControls, type OpenRouterRequestContext } from './openrouterRequest';
export { validateOpenRouterSettings, hardOpenRouterConstraints } from './openrouterRequest';
export { observeOpenRouterHeaders, observeOpenRouterUsage } from './openrouterRequest';
export type { OpenRouterRequestContext } from './openrouterRequest';

export const isOpenRouterEndpoint = (endpoint: string): boolean => {
  try {
    const url = new URL(endpoint);
    return isOpenRouterURL(url);
  } catch { return false; }
};

export function canUseOpenRouterResponseCache(): boolean {
  const state = useStore.getState();
  return state.proxyEnabled && !!state.proxyEndpoint?.trim();
}

export function assertAuxiliaryEndpoint(settings: OpenRouterChatSettings | undefined, endpoint: string): void {
  if (hardOpenRouterConstraints(settings) && !isOpenRouterEndpoint(endpoint)) throw new Error(i18next.t('model:openRouter.errors.auxiliary') as string);
}

export function applyOpenRouterControls(endpoint: string, config: ConfigInterface, body: Record<string, unknown>, headers: Record<string, string>, context?: OpenRouterRequestContext): void {
  applyControls(isOpenRouterEndpoint(endpoint), config, body, headers, context);
}
