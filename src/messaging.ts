/**
 * Typed messaging between side panel, background worker and content scripts.
 * Every reply is an envelope, so errors cross the boundary as data, not as lost exceptions.
 */
import { browser } from 'wxt/browser';
import type { ChatMeta, ProviderId, SweepAction } from './core/types';
import { ProviderError, toErrorInfo, type ProviderErrorInfo, type SessionInfo } from './providers/types';

export type ContentRequest =
  | { target: 'content'; type: 'session' }
  | { target: 'content'; type: 'list' }
  | { target: 'content'; type: 'act'; action: SweepAction; id: string }
  | { target: 'content'; type: 'export'; id: string };

export interface ContentResponses {
  session: SessionInfo;
  list: ChatMeta[];
  act: null;
  export: unknown;
}

export type BackgroundRequest =
  | {
      target: 'background';
      type: 'job:start';
      provider: ProviderId;
      action: SweepAction;
      tabId: number;
      items: Array<{ id: string; title: string }>;
    }
  | { target: 'background'; type: 'job:pause' }
  | { target: 'background'; type: 'job:resume' }
  | { target: 'background'; type: 'job:cancel' }
  | { target: 'background'; type: 'job:retry-failed' }
  | { target: 'background'; type: 'job:dismiss' }
  | { target: 'background'; type: 'schedule:check-now'; provider: ProviderId };

export type UiEvent = {
  target: 'ui';
  type: 'list-progress';
  provider: ProviderId;
  loaded: number;
  total: number | null;
};

type Envelope<T> = { ok: true; data: T } | { ok: false; error: ProviderErrorInfo };

type AnyRequest = ContentRequest | BackgroundRequest | UiEvent;

/** Register a handler for messages addressed to `target`. Other targets are ignored. */
export function listen<M extends AnyRequest>(
  target: M['target'],
  handler: (msg: M) => Promise<unknown> | unknown,
): void {
  browser.runtime.onMessage.addListener((raw: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
    const msg = raw as AnyRequest | undefined;
    if (!msg || typeof msg !== 'object' || msg.target !== target) return undefined;
    Promise.resolve()
      .then(() => handler(msg as M))
      .then(
        (data) => sendResponse({ ok: true, data: data ?? null } satisfies Envelope<unknown>),
        (err) => sendResponse({ ok: false, error: toErrorInfo(err) } satisfies Envelope<unknown>),
      );
    return true; // keep the channel open for the async reply
  });
}

function unwrap<T>(reply: unknown): T {
  const env = reply as Envelope<T> | undefined;
  if (!env || typeof env !== 'object' || !('ok' in env)) {
    throw new ProviderError('no-tab', 'No response from ChatSweep in that tab. Reload the tab and try again.');
  }
  if (!env.ok) {
    const e = env.error;
    throw new ProviderError(e.code, e.message, e.status, e.retryAfterMs ?? null);
  }
  return env.data;
}

const NOT_INJECTED = /receiving end does not exist|could not establish connection|no tab with id/i;

export async function sendToTab<K extends ContentRequest['type']>(
  tabId: number,
  msg: Extract<ContentRequest, { type: K }>,
): Promise<ContentResponses[K]> {
  let reply: unknown;
  try {
    reply = await browser.tabs.sendMessage(tabId, msg);
  } catch (err) {
    const text = (err as Error)?.message ?? String(err);
    if (NOT_INJECTED.test(text)) {
      throw new ProviderError('no-tab', 'ChatSweep is not active in that tab yet. Reload the tab.');
    }
    throw new ProviderError('unknown', text);
  }
  return unwrap<ContentResponses[K]>(reply);
}

export async function sendToBackground(msg: BackgroundRequest): Promise<unknown> {
  return unwrap<unknown>(await browser.runtime.sendMessage(msg));
}

/** Fire-and-forget event to any open side panel. */
export function emitUi(event: UiEvent): void {
  browser.runtime.sendMessage(event).catch(() => {
    /* no side panel open — fine */
  });
}

export function onUiEvent(handler: (e: UiEvent) => void): () => void {
  const listener = (raw: unknown) => {
    const msg = raw as UiEvent | undefined;
    if (msg && typeof msg === 'object' && msg.target === 'ui') handler(msg);
    return undefined;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
