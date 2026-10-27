/**
 * A scheduled (or "Check now") run: refresh the chat list in the background, count what the
 * saved rules would sweep, and leave a PendingReview for the user. It NEVER sweeps.
 */
import { countSweepable, type PendingReview } from '../core/schedule';
import type { ChatMeta, Overrides, ProviderId, RuleSet, SweepAction } from '../core/types';
import { toErrorInfo } from '../providers/types';

export interface SchedulerDeps {
  /** A tab on the provider's site, or null if none is open. */
  findTab(): Promise<number | null>;
  list(tabId: number): Promise<ChatMeta[]>;
  loadRules(): Promise<RuleSet>;
  loadOverrides(): Promise<Overrides>;
  action(): Promise<SweepAction>;
  saveChats(chats: ChatMeta[], fetchedAt: number): Promise<void>;
  savePending(p: PendingReview): Promise<void>;
  /** A sweep is running: skip this check rather than compete for the rate limit. */
  jobRunning(): boolean;
  now(): number;
}

export async function runScheduledCheck(provider: ProviderId, deps: SchedulerDeps): Promise<PendingReview | null> {
  if (deps.jobRunning()) return null;
  const checkedAt = deps.now();

  let pending: PendingReview;
  try {
    const tabId = await deps.findTab();
    if (tabId == null) {
      pending = { provider, status: 'needs-tab', checkedAt };
    } else {
      const chats = await deps.list(tabId);
      await deps.saveChats(chats, checkedAt);
      const [rules, overrides, action] = await Promise.all([deps.loadRules(), deps.loadOverrides(), deps.action()]);
      const count = countSweepable(chats, rules, overrides, new Date(checkedAt));
      pending = { provider, status: 'ready', checkedAt, count, action };
    }
  } catch (err) {
    pending = { provider, status: 'error', checkedAt, message: toErrorInfo(err).message };
  }
  await deps.savePending(pending);
  return pending;
}
