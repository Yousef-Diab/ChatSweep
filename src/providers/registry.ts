import type { ProviderCapabilities, ProviderId, SweepAction } from '../core/types';

/** Static, UI-side facts about each provider (no network code here). */
export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  origin: string;
  tabPattern: string;
  capabilities: ProviderCapabilities;
  available: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  chatgpt: {
    id: 'chatgpt',
    displayName: 'ChatGPT',
    origin: 'https://chatgpt.com',
    tabPattern: 'https://chatgpt.com/*',
    capabilities: { archive: true, star: true, projects: true, assistants: true },
    available: true,
  },
  claude: {
    id: 'claude',
    displayName: 'Claude',
    origin: 'https://claude.ai',
    tabPattern: 'https://claude.ai/*',
    capabilities: { archive: false, star: true, projects: true, assistants: false },
    available: true,
  },
};

export const PROVIDER_LIST: readonly ProviderInfo[] = Object.values(PROVIDERS).filter((p) => p.available);

/** Decision #1: archive by default wherever the provider supports it. */
export function defaultAction(p: ProviderInfo): SweepAction {
  return p.capabilities.archive ? 'archive' : 'delete';
}

export function effectiveAction(p: ProviderInfo, pref: SweepAction | null): SweepAction {
  if (pref === 'archive' && !p.capabilities.archive) return 'delete';
  return pref ?? defaultAction(p);
}
