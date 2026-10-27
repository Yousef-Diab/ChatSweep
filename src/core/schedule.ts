/**
 * Scheduled checks: decision #4 is "queue + notify + one-click confirm".
 * A scheduled check only refreshes the chat list and counts what WOULD be swept. It never sweeps.
 */
import { plan } from './planner';
import type { ChatMeta, Overrides, ProviderId, RuleSet, SweepAction } from './types';

export interface Schedule {
  enabled: boolean;
  everyDays: number;
}

export const DEFAULT_SCHEDULE: Schedule = { enabled: false, everyDays: 7 };
export const SCHEDULE_CHOICES = [1, 7, 14, 30] as const;

export type PendingReview =
  | { provider: ProviderId; status: 'ready'; checkedAt: number; count: number; action: SweepAction }
  | { provider: ProviderId; status: 'needs-tab'; checkedAt: number }
  | { provider: ProviderId; status: 'error'; checkedAt: number; message: string };

export function alarmName(provider: ProviderId): string {
  return `chatsweep:schedule:${provider}`;
}

export function periodMinutes(s: Schedule): number {
  return Math.max(1, Math.round(s.everyDays)) * 24 * 60;
}

/** What a scheduled check found: how many chats the saved rules would sweep right now. */
export function countSweepable(chats: readonly ChatMeta[], rules: RuleSet, overrides: Overrides, now: Date): number {
  return plan(chats, rules, now, overrides).filter((d) => d.verdict === 'sweep').length;
}

/** Toolbar badge for a pending review: a count when chats await review, "!" when the check couldn't run. */
export function badgeFor(pending: PendingReview | null | undefined): { text: string; color: string } {
  if (!pending) return { text: '', color: '#0d9488' };
  if (pending.status === 'ready') {
    if (pending.count <= 0) return { text: '', color: '#0d9488' };
    return { text: pending.count > 999 ? '999+' : String(pending.count), color: '#0d9488' };
  }
  return { text: '!', color: '#d97706' };
}

/**
 * One toolbar badge for every provider's pending review: the total count of chats awaiting
 * review wins; otherwise "!" if any provider's check couldn't run.
 */
export function badgeForAll(pendings: ReadonlyArray<PendingReview | null | undefined>): { text: string; color: string } {
  const count = pendings.reduce((n, p) => n + (p?.status === 'ready' ? Math.max(0, p.count) : 0), 0);
  if (count > 0) return badgeFor({ provider: 'chatgpt', status: 'ready', checkedAt: 0, count, action: 'archive' });
  const problem = pendings.find((p) => p && p.status !== 'ready');
  return badgeFor(problem ?? null);
}
