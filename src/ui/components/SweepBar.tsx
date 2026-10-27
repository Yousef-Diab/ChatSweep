import { useEffect, useState } from 'react';
import type { SweepAction } from '../../core/types';
import type { ProviderInfo } from '../../providers/registry';
import { plural } from '../format';

export function SweepBar(props: {
  provider: ProviderInfo;
  count: number;
  action: SweepAction;
  blockedReason: string | null;
  onActionChange: (a: SweepAction) => void;
  onStart: (opts: { backup: boolean }) => Promise<void>;
  /** "Backing up 3 / 13…" while a pre-sweep backup is running. */
  busyText?: string | null;
}) {
  const { provider, count, action, blockedReason, onActionChange, onStart, busyText } = props;
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  // Backup defaults ON for permanent deletes, OFF for (reversible) archives.
  const [backup, setBackup] = useState(action === 'delete');

  // Any change to what would be swept cancels a pending confirmation.
  useEffect(() => {
    setConfirming(false);
    setTyped('');
    setBackup(action === 'delete');
  }, [count, action]);

  const verb = action === 'archive' ? 'Archive' : 'Delete';
  const needsTyping = action === 'delete';
  const canConfirm = !needsTyping || typed.trim() === String(count);

  return (
    <div className="sticky bottom-0 -mx-3 border-t border-zinc-200 bg-zinc-50/95 px-3 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      {!confirming ? (
        <div className="flex items-center gap-2">
          <select
            className="input w-auto"
            value={action}
            onChange={(e) => onActionChange(e.target.value as SweepAction)}
            aria-label="Action"
          >
            {provider.capabilities.archive && <option value="archive">Archive (reversible)</option>}
            <option value="delete">Delete (permanent)</option>
          </select>
          <button
            className={`btn flex-1 ${action === 'delete' ? 'btn-danger' : 'btn-primary'}`}
            disabled={count === 0 || !!blockedReason}
            title={blockedReason ?? undefined}
            onClick={() => setConfirming(true)}
          >
            {verb} {plural(count, 'chat')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs">
            {action === 'archive' ? (
              <>
                {plural(count, 'chat')} will be archived. You can restore them in {provider.displayName} →
                Settings → Data controls → Archived chats.
              </>
            ) : (
              <>
                <strong className="text-red-600 dark:text-red-400">{plural(count, 'chat')} will be deleted.</strong>{' '}
                {provider.displayName} has no way to bring them back. Type <strong>{count}</strong> to confirm.
              </>
            )}
          </p>
          {needsTyping && (
            <input
              className="input"
              autoFocus
              inputMode="numeric"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={String(count)}
            />
          )}
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-brand-600"
              checked={backup}
              disabled={busy}
              onChange={(e) => setBackup(e.target.checked)}
            />
            <span>Download a backup first (Markdown + raw JSON, zipped)</span>
          </label>
          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setConfirming(false)} disabled={busy}>
              Back
            </button>
            <button
              className={`btn flex-1 ${action === 'delete' ? 'btn-danger' : 'btn-primary'}`}
              disabled={!canConfirm || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onStart({ backup });
                  setConfirming(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (busyText ?? 'Starting…') : `Yes, ${verb.toLowerCase()} ${count}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
