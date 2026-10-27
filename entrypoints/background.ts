import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { alarmName, badgeFor, periodMinutes, type PendingReview } from '../src/core/schedule';
import { JobController } from '../src/jobs/controller';
import type { Job } from '../src/jobs/runner';
import { runScheduledCheck } from '../src/jobs/scheduler';
import { listen, sendToTab, type BackgroundRequest } from '../src/messaging';
import { effectiveAction, PROVIDERS } from '../src/providers/registry';
import { ProviderError } from '../src/providers/types';
import {
  actionPrefItem,
  chatsItem,
  jobItem,
  normalizeRules,
  overridesItem,
  pendingItem,
  rulesItem,
  scheduleItem,
} from '../src/storage';

/**
 * MV3 service workers are stopped after ~30s without extension events. Long backoff waits
 * are split into chunks with a cheap API call in between, which keeps the worker alive.
 * If it is killed anyway, JobController.recover() marks the job "interrupted" on next start.
 */
async function keepAliveSleep(ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, Math.min(20_000, end - Date.now())));
    await browser.runtime.getPlatformInfo();
  }
}

/** The job's tab if it is still on the provider; otherwise any other tab on the provider. */
async function resolveTab(job: Job): Promise<number> {
  const provider = PROVIDERS[job.provider];
  if (job.tabId != null) {
    const tab = await browser.tabs.get(job.tabId).catch(() => null);
    if (tab?.id != null && tab.url?.startsWith(provider.origin)) return tab.id;
  }
  const [other] = await browser.tabs.query({ url: provider.tabPattern });
  if (other?.id != null) {
    job.tabId = other.id;
    return other.id;
  }
  throw new ProviderError('no-tab', `Open ${provider.displayName} in a tab, then press Resume.`);
}

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel (Chromium) or toggles the sidebar (Firefox).
  if (browser.sidePanel) {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  } else {
    const sidebar = (browser as unknown as { sidebarAction?: { toggle(): Promise<void> } }).sidebarAction;
    if (sidebar) browser.action.onClicked.addListener(() => void sidebar.toggle());
  }

  const provider = PROVIDERS.chatgpt;
  const schedule = scheduleItem(provider.id);
  const pending = pendingItem(provider.id);

  const controller = new JobController({
    load: () => jobItem.getValue(),
    store: (job) => jobItem.setValue(job),
    act: async (item, job) => {
      const tabId = await resolveTab(job);
      await sendToTab(tabId, { target: 'content', type: 'act', action: job.action, id: item.id });
    },
    sleep: keepAliveSleep,
    now: () => Date.now(),
    // Drop chats that were swept from the preview cache, so the list matches reality.
    onRunEnd: async (job) => {
      const swept = new Set(job.items.filter((i) => i.status === 'done').map((i) => i.id));
      if (!swept.size) return;
      const item = chatsItem(job.provider);
      const cached = await item.getValue();
      if (cached) await item.setValue({ ...cached, chats: cached.chats.filter((c) => !swept.has(c.id)) });
    },
  });

  void controller.recover();

  // ---- Scheduled checks: queue + notify only. They never sweep. ---------------------------
  const checkNow = () =>
    runScheduledCheck(provider.id, {
      findTab: async () => (await browser.tabs.query({ url: provider.tabPattern }))[0]?.id ?? null,
      list: (tabId) => sendToTab(tabId, { target: 'content', type: 'list' }),
      loadRules: async () => normalizeRules(await rulesItem(provider.id).getValue()),
      loadOverrides: () => overridesItem(provider.id).getValue(),
      action: async () => effectiveAction(provider, await actionPrefItem(provider.id).getValue()),
      saveChats: async (chats, fetchedAt) => {
        const item = chatsItem(provider.id);
        const prev = await item.getValue();
        await item.setValue({ fetchedAt, accountLabel: prev?.accountLabel, chats });
      },
      savePending: (p) => pending.setValue(p),
      jobRunning: () => controller.isRunning,
      now: () => Date.now(),
    });

  async function syncAlarm() {
    const s = await schedule.getValue();
    const name = alarmName(provider.id);
    if (!s.enabled) {
      await browser.alarms.clear(name);
      return;
    }
    const period = periodMinutes(s);
    const existing = await browser.alarms.get(name);
    if (existing?.periodInMinutes !== period) {
      await browser.alarms.create(name, { delayInMinutes: period, periodInMinutes: period });
    }
  }

  async function updateBadge(p: PendingReview | null) {
    const badge = badgeFor(p);
    await browser.action.setBadgeBackgroundColor({ color: badge.color });
    await browser.action.setBadgeText({ text: badge.text });
  }

  // Listeners must be registered synchronously so a sleeping worker is woken for them.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === alarmName(provider.id)) void checkNow();
  });
  schedule.watch(() => void syncAlarm());
  pending.watch((p) => void updateBadge(p));
  void syncAlarm();
  void pending.getValue().then(updateBadge);

  // ---- Messages from the side panel -----------------------------------------------------
  listen<BackgroundRequest>('background', async (msg) => {
    switch (msg.type) {
      case 'job:start': {
        const job = await controller.start({
          provider: msg.provider,
          action: msg.action,
          tabId: msg.tabId,
          items: msg.items,
        });
        await pendingItem(msg.provider).setValue(null); // the queued review has been acted on
        return job;
      }
      case 'job:pause':
        return controller.pause();
      case 'job:resume':
        return controller.resume();
      case 'job:cancel':
        return controller.cancel();
      case 'job:retry-failed':
        return controller.retryFailed();
      case 'job:dismiss':
        return controller.dismiss();
      case 'schedule:check-now':
        return checkNow();
    }
  });
});
