import { browser } from 'wxt/browser';
import type { ProviderInfo } from '../../providers/registry';
import type { ProviderTab } from '../hooks';

export type SessionState =
  | { status: 'no-tab' }
  | { status: 'checking' }
  | { status: 'ok'; accountLabel: string }
  | { status: 'error'; code: string; message: string };

export function ConnectionCard(props: {
  provider: ProviderInfo;
  tab: ProviderTab | null;
  session: SessionState;
  onRetry: () => void;
}) {
  const { provider, tab, session, onRetry } = props;

  if (!tab || session.status === 'no-tab') {
    return (
      <div className="card flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">No {provider.displayName} tab open</div>
          <div className="label">ChatSweep works through your logged-in {provider.displayName} tab.</div>
        </div>
        <button className="btn btn-primary" onClick={() => browser.tabs.create({ url: provider.origin })}>
          Open
        </button>
      </div>
    );
  }

  if (session.status === 'checking') {
    return <div className="card label">Connecting to {provider.displayName}…</div>;
  }

  if (session.status === 'error') {
    const needsReload = session.code === 'no-tab';
    return (
      <div className="card flex items-center justify-between gap-2 border-amber-300 dark:border-amber-700">
        <div className="min-w-0">
          <div className="font-medium text-amber-700 dark:text-amber-400">
            {session.code === 'not-logged-in' ? `Log in to ${provider.displayName}` : 'Not connected'}
          </div>
          <div className="label">{session.message}</div>
        </div>
        <button
          className="btn btn-ghost shrink-0"
          onClick={() => {
            if (needsReload) void browser.tabs.reload(tab.id).then(() => setTimeout(onRetry, 2500));
            else onRetry();
          }}
        >
          {needsReload ? 'Reload tab' : 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div className="card flex items-center gap-2">
      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
      <span className="truncate">
        Connected to {provider.displayName} as <span className="font-medium">{session.accountLabel}</span>
      </span>
    </div>
  );
}
