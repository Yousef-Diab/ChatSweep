/**
 * Everything ChatSweep stores lives in chrome.storage.local, on this device only.
 * Chat titles are cached for the preview; nothing is ever sent anywhere else.
 */
import { storage } from 'wxt/utils/storage';
import { DEFAULT_RULES, type ChatMeta, type Overrides, type ProviderId, type RuleSet, type SweepAction } from './core/types';
import type { Job } from './jobs/runner';
import type { Preset } from './core/presets';
import { DEFAULT_SCHEDULE, type PendingReview, type Schedule } from './core/schedule';

export interface CachedChats {
  fetchedAt: number;
  accountLabel?: string;
  chats: ChatMeta[];
}

export const rulesItem = (p: ProviderId) =>
  storage.defineItem<RuleSet>(`local:rules:${p}`, { fallback: DEFAULT_RULES });

export const overridesItem = (p: ProviderId) =>
  storage.defineItem<Overrides>(`local:overrides:${p}`, { fallback: {} });

export const chatsItem = (p: ProviderId) =>
  storage.defineItem<CachedChats | null>(`local:chats:${p}`, { fallback: null });

/** null = use the provider default (archive when available). */
export const actionPrefItem = (p: ProviderId) =>
  storage.defineItem<SweepAction | null>(`local:action:${p}`, { fallback: null });

/** The single current/last sweep job. */
export const jobItem = storage.defineItem<Job | null>('local:job', { fallback: null });

/** User-saved rule presets (built-ins live in code). */
export const presetsItem = (p: ProviderId) => storage.defineItem<Preset[]>(`local:presets:${p}`, { fallback: [] });

export const scheduleItem = (p: ProviderId) =>
  storage.defineItem<Schedule>(`local:schedule:${p}`, { fallback: DEFAULT_SCHEDULE });

/** Result of the last scheduled check, waiting for the user to review. Never acted on automatically. */
export const pendingItem = (p: ProviderId) =>
  storage.defineItem<PendingReview | null>(`local:pending:${p}`, { fallback: null });

/** Older stored rule sets may miss newer fields; fill them from the defaults. */
export function normalizeRules(stored: Partial<RuleSet> | null | undefined): RuleSet {
  return { ...DEFAULT_RULES, ...(stored ?? {}) };
}
