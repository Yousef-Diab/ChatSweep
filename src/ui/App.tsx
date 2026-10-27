import { useCallback, useEffect, useMemo, useState } from 'react';
import { plan, summarize } from '../core/planner';
import { validateRules } from '../core/rules';
import type { Overrides, SweepAction, Verdict } from '../core/types';
import { isActive, type Job } from '../jobs/runner';
import { onUiEvent, sendToBackground, sendToTab, type BackgroundRequest } from '../messaging';
import { effectiveAction, PROVIDER_LIST, PROVIDERS, type ProviderInfo } from '../providers/registry';
import { toErrorInfo } from '../providers/types';
import {
  actionPrefItem,
  chatsItem,
  consentItem,
  DATA_NOTICE_VERSION,
  jobItem,
  normalizeRules,
  overridesItem,
  panelProviderItem,
  pendingItem,
  presetsItem,
  rulesItem,
  scheduleItem,
} from '../storage';
import { backupFolderName, buildBackupZip, fetchForBackup } from '../backup/archive';
import { DEFAULT_SCHEDULE } from '../core/schedule';
import { ConnectionCard, type SessionState } from './components/ConnectionCard';
import { ConsentCard } from './components/ConsentCard';
import { JobCard } from './components/JobCard';
import { PresetPicker } from './components/PresetPicker';
import { PreviewCard } from './components/PreviewCard';
import { RulesCard } from './components/RulesCard';
import { PendingBanner, ScheduleCard } from './components/ScheduleCard';
import { SweepBar } from './components/SweepBar';
import { downloadBytes } from './download';
import { nf, relativeTime } from './format';
import { useProviderTab, useStorageItem } from './hooks';

/** Storage items per provider, created once: hooks subscribe by identity. */
const itemsFor = (() => {
  const cache = new Map<ProviderInfo['id'], ReturnType<typeof makeItems>>();
  function makeItems(id: ProviderInfo['id']) {
    return {
      RULES: rulesItem(id),
      OVERRIDES: overridesItem(id),
      CHATS: chatsItem(id),
      ACTION: actionPrefItem(id),
      PRESETS: presetsItem(id),
      SCHEDULE: scheduleItem(id),
      PENDING: pendingItem(id),
    };
  }
  return (id: ProviderInfo['id']) => {
    if (!cache.has(id)) cache.set(id, makeItems(id));
    return cache.get(id)!;
  };
})();

export function App() {
  const [selected, setSelected] = useStorageItem(panelProviderItem);
  const [consent, setConsent] = useStorageItem(consentItem);
  if (selected === undefined || consent === undefined) return null; // first storage read; avoids a flash
  if (consent < DATA_NOTICE_VERSION) {
    // Nothing (not even the session check) talks to a provider before the user has agreed.
    return (
      <main className="mx-auto max-w-xl space-y-3 p-3">
        <h1 className="text-base font-bold tracking-tight">🧹 ChatSweep</h1>
        <ConsentCard onAgree={() => void setConsent(DATA_NOTICE_VERSION)} />
      </main>
    );
  }
  const provider = PROVIDERS[selected]?.available ? PROVIDERS[selected] : PROVIDERS.chatgpt;
  // Keyed: switching provider remounts the view, so no state leaks between providers.
  return <ProviderView key={provider.id} provider={provider} onSwitch={(id) => void setSelected(id)} />;
}

function ProviderView({ provider, onSwitch }: { provider: ProviderInfo; onSwitch: (id: ProviderInfo['id']) => void }) {
  const { RULES, OVERRIDES, CHATS, ACTION, PRESETS, SCHEDULE, PENDING } = itemsFor(provider.id);
  const { tab, refresh: refreshTab } = useProviderTab(provider);
  const [storedRules, setRules] = useStorageItem(RULES);
  const [overridesRaw, setOverrides] = useStorageItem(OVERRIDES);
  const [cached, setCached] = useStorageItem(CHATS);
  const [actionPref, setActionPref] = useStorageItem(ACTION);
  const [job] = useStorageItem(jobItem);
  const [userPresets, setUserPresets] = useStorageItem(PRESETS);
  const [schedule, setSchedule] = useStorageItem(SCHEDULE);
  const [pending, setPending] = useStorageItem(PENDING);

  const [session, setSession] = useState<SessionState>({ status: 'no-tab' });
  const [loading, setLoading] = useState<{ loaded: number; total: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyText, setBusyText] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const rules = useMemo(() => normalizeRules(storedRules), [storedRules]);
  const overrides: Overrides = overridesRaw ?? {};
  const action = effectiveAction(provider, actionPref ?? null);

  // ---- connection -------------------------------------------------------
  const checkSession = useCallback(async () => {
    if (!tab) {
      setSession({ status: 'no-tab' });
      return;
    }
    setSession({ status: 'checking' });
    try {
      const info = await sendToTab(tab.id, { target: 'content', type: 'session' });
      setSession({ status: 'ok', accountLabel: info.accountLabel });
    } catch (err) {
      const e = toErrorInfo(err);
      setSession({ status: 'error', code: e.code, message: e.message });
    }
  }, [tab?.id]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(
    () =>
      onUiEvent((e) => {
        // Only while the panel itself is loading: background "Check now" runs emit progress too.
        if (e.type === 'list-progress' && e.provider === provider.id) {
          setLoading((prev) => (prev ? { loaded: e.loaded, total: e.total } : prev));
        }
      }),
    [],
  );

  // ---- load chats -------------------------------------------------------
  const loadChats = async () => {
    if (!tab) return;
    setError(null);
    setLoading({ loaded: 0, total: null });
    try {
      const chats = await sendToTab(tab.id, { target: 'content', type: 'list' });
      await setCached({
        fetchedAt: Date.now(),
        accountLabel: session.status === 'ok' ? session.accountLabel : undefined,
        chats,
      });
    } catch (err) {
      setError(toErrorInfo(err).message);
    } finally {
      setLoading(null);
    }
  };

  // ---- plan -------------------------------------------------------------
  const jobForProvider = job && job.provider === provider.id ? job : null;
  const handled = useMemo(
    () => new Set((jobForProvider?.items ?? []).filter((i) => i.status === 'done').map((i) => i.id)),
    [jobForProvider],
  );
  const decisions = useMemo(
    () => (cached ? plan(cached.chats.filter((c) => !handled.has(c.id)), rules, new Date(), overrides) : []),
    [cached, rules, overrides, handled],
  );
  const summary = useMemo(() => summarize(decisions), [decisions]);
  const problems = useMemo(() => validateRules(rules), [rules]);
  const pinned = useMemo(() => new Set(rules.protectedIds), [rules.protectedIds]);
  const toSweep = decisions.filter((d) => d.verdict === 'sweep');

  const setOverride = (id: string, verdict: Verdict | null) => {
    const next = { ...overrides };
    if (verdict) next[id] = verdict;
    else delete next[id];
    void setOverrides(next);
  };

  const togglePin = (id: string) => {
    const ids = pinned.has(id) ? rules.protectedIds.filter((x) => x !== id) : [...rules.protectedIds, id];
    void setRules({ ...rules, protectedIds: ids });
  };

  // ---- jobs -------------------------------------------------------------
  const bg = async (msg: BackgroundRequest) => {
    setError(null);
    try {
      await sendToBackground(msg);
    } catch (err) {
      setError(toErrorInfo(err).message);
    }
  };

  /** Optional backup first; if any chat can't be backed up, nothing is swept. */
  const startSweep = async ({ backup }: { backup: boolean }) => {
    if (!tab) return;
    setError(null);
    if (backup) {
      const chats = toSweep.map((d) => d.chat);
      try {
        setBusyText(`Backing up 0 / ${nf.format(chats.length)}…`);
        const entries = await fetchForBackup(chats, {
          fetchRaw: (id) => sendToTab(tab.id, { target: 'content', type: 'export', id }),
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          onProgress: (done, total) => setBusyText(`Backing up ${nf.format(done)} / ${nf.format(total)}…`),
        });
        setBusyText('Zipping backup…');
        const now = new Date();
        downloadBytes(buildBackupZip(provider.id, entries, now), `${backupFolderName(now)}.zip`);
      } catch (err) {
        setError(`${(err as Error).message} Nothing was swept.`);
        return;
      } finally {
        setBusyText(null);
      }
    }
    await bg({
      target: 'background',
      type: 'job:start',
      provider: provider.id,
      action,
      tabId: tab.id,
      items: toSweep.map((d) => ({ id: d.chat.id, title: d.chat.title })),
    });
  };

  const running = isActive(job);
  const blockedReason =
    session.status !== 'ok'
      ? `Connect to ${provider.displayName} first.`
      : problems.length
        ? 'Fix the rule problems first.'
        : running
          ? 'A sweep is already running.'
          : job && (job.status === 'paused' || job.status === 'interrupted')
            ? 'Resume or cancel the paused sweep first.'
            : null;

  return (
    <main className="mx-auto max-w-xl space-y-3 p-3">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-base font-bold tracking-tight">🧹 ChatSweep</h1>
        <span className="text-[11px] text-zinc-500">local-only · no tracking</span>
      </header>

      <nav className="flex gap-1 rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800" aria-label="Provider">
        {PROVIDER_LIST.map((p) => (
          <button
            key={p.id}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              p.id === provider.id
                ? 'bg-white shadow-sm dark:bg-zinc-950'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
            aria-pressed={p.id === provider.id}
            onClick={() => onSwitch(p.id)}
          >
            {p.displayName}
          </button>
        ))}
      </nav>

      <ConnectionCard
        provider={provider}
        tab={tab}
        session={session}
        onRetry={() => {
          refreshTab();
          void checkSession();
        }}
      />

      {job && (
        <JobCard
          job={job as Job}
          otherProviderName={job.provider !== provider.id ? PROVIDERS[job.provider].displayName : undefined}
          onPause={() => bg({ target: 'background', type: 'job:pause' })}
          onResume={() => bg({ target: 'background', type: 'job:resume' })}
          onCancel={() => bg({ target: 'background', type: 'job:cancel' })}
          onRetry={() => bg({ target: 'background', type: 'job:retry-failed' })}
          onDismiss={() => bg({ target: 'background', type: 'job:dismiss' })}
        />
      )}

      {pending && <PendingBanner provider={provider} pending={pending} onDismiss={() => void setPending(null)} />}

      {error && (
        <div className="card border-red-300 text-xs text-red-700 dark:border-red-800 dark:text-red-300">{error}</div>
      )}

      <section className="card flex items-center justify-between gap-2">
        <div className="min-w-0">
          {loading ? (
            <span>
              Loading chats… {nf.format(loading.loaded)}
              {loading.total != null && ` / ${nf.format(loading.total)}`}
            </span>
          ) : cached ? (
            <span>
              <span className="font-medium">{nf.format(cached.chats.length)}</span> chats loaded{' '}
              <span className="label">· {relativeTime(cached.fetchedAt)}</span>
            </span>
          ) : (
            <span className="label">Load your chat list to preview a sweep. Nothing is changed yet.</span>
          )}
        </div>
        <button
          className="btn btn-ghost shrink-0"
          disabled={session.status !== 'ok' || !!loading || running}
          onClick={loadChats}
        >
          {cached ? 'Refresh' : 'Load chats'}
        </button>
      </section>

      <RulesCard
        rules={rules}
        capabilities={provider.capabilities}
        problems={problems}
        onChange={(r) => void setRules(r)}
        presetSlot={
          <PresetPicker
            rules={rules}
            userPresets={userPresets ?? []}
            onApply={(r) => void setRules(r)}
            onSaveUserPresets={(p) => void setUserPresets(p)}
          />
        }
      />

      <ScheduleCard
        provider={provider}
        schedule={schedule ?? DEFAULT_SCHEDULE}
        onChange={(s) => void setSchedule(s)}
        checking={checking}
        canCheck={session.status === 'ok' && !running}
        onCheckNow={async () => {
          setChecking(true);
          await bg({ target: 'background', type: 'schedule:check-now', provider: provider.id });
          setChecking(false);
        }}
      />

      {cached && (
        <>
          <PreviewCard
            decisions={decisions}
            summary={summary}
            overrides={overrides}
            pinned={pinned}
            onOverride={setOverride}
            onTogglePin={togglePin}
            onClearOverrides={() => void setOverrides({})}
          />
          <SweepBar
            provider={provider}
            count={toSweep.length}
            action={action}
            blockedReason={blockedReason}
            onActionChange={(a: SweepAction) => void setActionPref(a)}
            onStart={startSweep}
            busyText={busyText}
          />
        </>
      )}
    </main>
  );
}
