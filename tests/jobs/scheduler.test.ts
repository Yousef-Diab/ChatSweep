import { describe, expect, it } from 'vitest';
import type { PendingReview } from '../../src/core/schedule';
import { DEFAULT_RULES, type ChatMeta } from '../../src/core/types';
import { runScheduledCheck, type SchedulerDeps } from '../../src/jobs/scheduler';
import { ProviderError } from '../../src/providers/types';
import { NOW, chat } from '../helpers';

function deps(over: Partial<SchedulerDeps> = {}) {
  const saved: { chats?: ChatMeta[]; pending?: PendingReview } = {};
  const chats = Array.from({ length: 35 }, (_, i) => chat({ daysAgo: i + 1 }));
  const d: SchedulerDeps = {
    findTab: async () => 7,
    list: async () => chats,
    loadRules: async () => DEFAULT_RULES,
    loadOverrides: async () => ({}),
    action: async () => 'archive',
    saveChats: async (c) => {
      saved.chats = c;
    },
    savePending: async (p) => {
      saved.pending = p;
    },
    jobRunning: () => false,
    now: () => NOW.getTime(),
    ...over,
  };
  return { d, saved };
}

describe('runScheduledCheck', () => {
  it('refreshes the cache and queues a review, without sweeping', async () => {
    const { d, saved } = deps();
    const result = await runScheduledCheck('chatgpt', d);
    expect(result).toEqual({ provider: 'chatgpt', status: 'ready', checkedAt: NOW.getTime(), count: 5, action: 'archive' });
    expect(saved.chats).toHaveLength(35);
    expect(saved.pending).toEqual(result);
  });

  it('asks for a tab when none is open', async () => {
    const { d, saved } = deps({ findTab: async () => null });
    expect((await runScheduledCheck('chatgpt', d))!.status).toBe('needs-tab');
    expect(saved.chats).toBeUndefined();
  });

  it('records errors instead of throwing', async () => {
    const { d } = deps({
      list: async () => {
        throw new ProviderError('not-logged-in', 'Not logged in to ChatGPT.');
      },
    });
    expect(await runScheduledCheck('chatgpt', d)).toMatchObject({ status: 'error', message: 'Not logged in to ChatGPT.' });
  });

  it('skips entirely while a sweep is running', async () => {
    const { d, saved } = deps({ jobRunning: () => true });
    expect(await runScheduledCheck('chatgpt', d)).toBeNull();
    expect(saved.pending).toBeUndefined();
  });
});
