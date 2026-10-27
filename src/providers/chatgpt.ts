/**
 * ChatGPT adapter.
 *
 * Uses the same internal endpoints as the chatgpt.com web app (unofficial — they can change):
 *   GET   /api/auth/session                                     → { accessToken, account?: { id } }
 *   GET   /backend-api/conversations?offset&limit&order=updated → { items, total, limit, offset }
 *   PATCH /backend-api/conversation/{id}  { is_archived: true }   archive (reversible)
 *   PATCH /backend-api/conversation/{id}  { is_visible: false }   delete (hidden from the user; not recoverable in the UI)
 *
 * Note: chats inside Projects are listed by a separate endpoint and do not appear in the main
 * list, so v0.1 never touches project chats.
 *
 * The access token lives only in this object's memory. It is never stored, logged or messaged.
 */
import type { ChatMeta, ProviderCapabilities, SweepAction } from '../core/types';
import { ProviderError, type ListProgress, type Provider, type SessionInfo } from './types';

export const CHATGPT_ORIGIN = 'https://chatgpt.com';
const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 350;
const MAX_PAGES = 2_000; // 200k chats — a guard against pagination loops, not a real limit

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ChatGptRawItem {
  id?: unknown;
  title?: unknown;
  create_time?: unknown;
  update_time?: unknown;
  gizmo_id?: unknown;
  project_id?: unknown;
  is_archived?: unknown;
  is_starred?: unknown;
  pinned_time?: unknown;
  is_pinned?: unknown;
}

/** Accepts ISO strings, epoch seconds (float) or epoch milliseconds. Returns ISO or '' if unusable. */
export function toIso(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return toIso(asNumber);
    const t = Date.parse(value);
    return Number.isNaN(t) ? '' : new Date(t).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value < 1e11 ? value * 1000 : value; // seconds vs milliseconds
    return new Date(ms).toISOString();
  }
  return '';
}

/** Pure mapping from a raw list item to ChatMeta. Returns null for items without an id. */
export function mapChatGptItem(raw: ChatGptRawItem): ChatMeta | null {
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const gizmo = typeof raw.gizmo_id === 'string' && raw.gizmo_id ? raw.gizmo_id : null;
  const explicitProject = typeof raw.project_id === 'string' && raw.project_id ? raw.project_id : null;
  // Projects are implemented as "g-p-…" gizmos; anything else starting with "g-" is a custom GPT.
  const projectId = explicitProject ?? (gizmo?.startsWith('g-p-') ? gizmo : null);
  const assistantId = gizmo && !gizmo.startsWith('g-p-') ? gizmo : null;
  const createdAt = toIso(raw.create_time);
  const updatedAt = toIso(raw.update_time) || createdAt;

  return {
    id: raw.id,
    provider: 'chatgpt',
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Untitled chat',
    createdAt,
    updatedAt,
    projectId,
    assistantId,
    archived: raw.is_archived === true,
    starred: raw.is_starred === true || raw.is_pinned === true || (raw.pinned_time != null && raw.pinned_time !== false),
  };
}

export function parseRetryAfter(header: string | null, nowMs = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

/**
 * In Chromium, a content script's fetch already runs as the page (same origin, page cookies).
 * In Firefox it runs with the extension's principal; `content.fetch` is the page-context variant.
 */
export function pageFetch(scope: unknown = globalThis): FetchLike {
  const firefoxContent = (scope as { content?: { fetch?: typeof fetch } }).content;
  if (firefoxContent && typeof firefoxContent.fetch === 'function') {
    const f = firefoxContent.fetch;
    return (input, init) => f.call(firefoxContent, input, init);
  }
  return (input, init) => fetch(input, init);
}

export interface ChatGptOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  origin?: string;
}

export class ChatGptProvider implements Provider {
  readonly id = 'chatgpt' as const;
  readonly displayName = 'ChatGPT';
  readonly capabilities: ProviderCapabilities = { archive: true, star: true, projects: true, assistants: true };

  private token: string | null = null;
  private accountId: string | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly origin: string;

  constructor(opts: ChatGptOptions = {}) {
    this.fetchImpl = opts.fetch ?? pageFetch();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.origin = opts.origin ?? CHATGPT_ORIGIN;
  }

  async getSession(): Promise<SessionInfo> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.origin}/api/auth/session`, { credentials: 'include', cache: 'no-store' });
    } catch (err) {
      throw new ProviderError('network', `Could not reach ChatGPT: ${(err as Error).message}`);
    }
    if (!res.ok) throw new ProviderError('not-logged-in', 'Not logged in to ChatGPT.', res.status);
    const data = (await res.json().catch(() => null)) as {
      accessToken?: string;
      account?: { id?: string; name?: string; planType?: string };
      user?: { email?: string; name?: string };
    } | null;
    if (!data?.accessToken) throw new ProviderError('not-logged-in', 'Not logged in to ChatGPT.');
    this.token = data.accessToken;
    this.accountId = data.account?.id ?? null;
    return { accountLabel: data.user?.email ?? data.user?.name ?? data.account?.name ?? 'ChatGPT account' };
  }

  async listChats(onProgress?: (p: ListProgress) => void): Promise<ChatMeta[]> {
    const seen = new Map<string, ChatMeta>();
    let offset = 0;

    // `total` is NOT trustworthy: a live account (2026-10-27 probe) reported total=101 while the
    // second page still returned 100 new chats. So we ignore it and page until a short/empty page.
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.request<{ items?: unknown }>(
        'GET',
        // Already-archived chats are left alone, so only ask for visible, unarchived ones.
        `/conversations?offset=${offset}&limit=${PAGE_SIZE}&order=updated&is_archived=false`,
      );
      if (!body || !Array.isArray(body.items)) {
        throw new ProviderError('bad-response', 'ChatGPT returned an unexpected conversation list. The site may have changed.');
      }

      const before = seen.size;
      for (const raw of body.items as ChatGptRawItem[]) {
        const chat = mapChatGptItem(raw);
        if (chat && !seen.has(chat.id)) seen.set(chat.id, chat);
      }
      offset += body.items.length;
      onProgress?.({ loaded: seen.size, total: null });

      const lastPage = body.items.length < PAGE_SIZE;
      const noProgress = body.items.length > 0 && seen.size === before; // server ignoring offset → stop, don't loop
      if (lastPage || noProgress) return [...seen.values()];
      await this.sleep(PAGE_DELAY_MS);
    }
    throw new ProviderError('bad-response', 'Gave up paging the conversation list (too many pages).');
  }

  async apply(action: SweepAction, chatId: string): Promise<void> {
    const patch = action === 'archive' ? { is_archived: true } : { is_visible: false };
    const res = await this.request<{ success?: boolean } | null>(
      'PATCH',
      `/conversation/${encodeURIComponent(chatId)}`,
      patch,
    );
    if (res && typeof res === 'object' && 'success' in res && res.success === false) {
      throw new ProviderError('bad-response', `ChatGPT refused to ${action} this chat.`);
    }
  }

  /** Full conversation (for backups). Returned untouched; see backup/chatgptMarkdown.ts for rendering. */
  async exportChat(chatId: string): Promise<unknown> {
    const raw = await this.request<unknown>('GET', `/conversation/${encodeURIComponent(chatId)}`);
    if (!raw || typeof raw !== 'object' || !('mapping' in raw)) {
      throw new ProviderError('bad-response', 'ChatGPT returned an unexpected conversation. The site may have changed.');
    }
    return raw;
  }

  /** One HTTP call. Refreshes the token once on 401; maps failures to ProviderError. No retry loop here — the job runner owns retries. */
  private async request<T>(method: 'GET' | 'PATCH', path: string, body?: unknown, isRetry = false): Promise<T> {
    if (!this.token) await this.getSession();

    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.accountId) headers['ChatGPT-Account-ID'] = this.accountId;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.origin}/backend-api${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError('network', `Network error: ${(err as Error).message}`);
    }

    if (res.status === 401 && !isRetry) {
      this.token = null;
      return this.request<T>(method, path, body, true);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('unauthorized', 'ChatGPT session expired. Reload the ChatGPT tab and log in again.', res.status);
    }
    if (res.status === 404) throw new ProviderError('not-found', 'Chat not found (already removed?).', 404);
    if (res.status === 429) {
      throw new ProviderError('rate-limited', 'ChatGPT is rate-limiting requests.', 429, parseRetryAfter(res.headers.get('retry-after')));
    }
    if (res.status >= 500) throw new ProviderError('server', `ChatGPT server error (${res.status}).`, res.status);
    if (!res.ok) throw new ProviderError('unknown', `Unexpected HTTP ${res.status}.`, res.status);

    if (res.status === 204) return null as T;
    const text = await res.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError('bad-response', 'ChatGPT returned something that is not JSON.');
    }
  }
}
