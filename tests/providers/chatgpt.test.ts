import { describe, expect, it } from 'vitest';
import page from '../fixtures/chatgpt/conversations-page.synthetic.json';
import liveItem from '../fixtures/chatgpt/conversations-item.live-shape.json';
import { ChatGptProvider, mapChatGptItem, pageFetch, parseRetryAfter, toIso } from '../../src/providers/chatgpt';
import { ProviderError } from '../../src/providers/types';

type Call = { url: string; init?: RequestInit };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Fake fetch: routes by URL substring, records calls. Handlers may be a queue. */
function fakeFetch(routes: Array<[match: string, respond: (call: Call) => Response]>) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    const route = routes.find(([m]) => url.includes(m));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route[1](call);
  };
  return { fn, calls };
}

const session = () => json({ accessToken: 'tok-1', account: { id: 'acct-9' }, user: { email: 'me@example.com' } });
const noSleep = async () => {};

describe('toIso', () => {
  it('handles ISO strings, epoch seconds, epoch ms and junk', () => {
    expect(toIso('2026-10-26T19:02:11.123456Z')).toBe('2026-10-26T19:02:11.123Z');
    expect(toIso(1760000000.5)).toBe('2025-10-09T08:53:20.500Z');
    expect(toIso(1760000000500)).toBe('2025-10-09T08:53:20.500Z');
    expect(toIso('1760000000')).toBe('2025-10-09T08:53:20.000Z');
    expect(toIso(null)).toBe('');
    expect(toIso('nope')).toBe('');
    expect(toIso(0)).toBe('');
  });
});

describe('mapChatGptItem', () => {
  it('maps the fixture page', () => {
    const mapped = page.items.map((i) => mapChatGptItem(i));
    expect(mapped[0]).toMatchObject({
      provider: 'chatgpt',
      title: 'Trip planning: Petra',
      updatedAt: '2026-10-26T19:02:11.123Z',
      projectId: null,
      assistantId: null,
      starred: false,
      archived: false,
    });
    expect(mapped[1]).toMatchObject({ assistantId: 'g-abc123', projectId: null });
    // g-p-… is a Project, untitled falls back, missing update_time falls back to create_time
    expect(mapped[2]).toMatchObject({
      projectId: 'g-p-68aa0000000000000000000000000000',
      assistantId: null,
      title: 'Untitled chat',
      updatedAt: '2025-01-02T03:04:05.000Z',
    });
  });

  it('treats pinned/starred variants as starred', () => {
    expect(mapChatGptItem({ id: 'a', is_starred: true })!.starred).toBe(true);
    expect(mapChatGptItem({ id: 'a', is_pinned: true })!.starred).toBe(true);
    expect(mapChatGptItem({ id: 'a', pinned_time: '2026-01-01T00:00:00Z' })!.starred).toBe(true);
    expect(mapChatGptItem({ id: 'a', pinned_time: null })!.starred).toBe(false);
  });

  it('maps the live item shape (2026-10-27 probe)', () => {
    const { _note, ...item } = liveItem;
    expect(mapChatGptItem(item)).toEqual({
      id: item.id,
      provider: 'chatgpt',
      title: item.title,
      createdAt: '2026-10-27T10:12:42.158Z',
      updatedAt: '2026-10-27T11:03:22.922Z',
      projectId: null,
      assistantId: null,
      archived: false,
      starred: false, // pinned_time: null, is_starred: null
    });
  });

  it('drops items without an id', () => {
    expect(mapChatGptItem({ title: 'x' })).toBeNull();
  });
});

describe('pageFetch', () => {
  it('uses Firefox content.fetch when present, bound to its object', async () => {
    const calls: string[] = [];
    const content = {
      fetch(this: unknown, url: string) {
        calls.push(this === content ? `bound:${url}` : `unbound:${url}`);
        return Promise.resolve(new Response('{}'));
      },
    };
    await pageFetch({ content })('https://chatgpt.com/x');
    expect(calls).toEqual(['bound:https://chatgpt.com/x']);
  });

  it('falls back to the global fetch elsewhere', () => {
    expect(typeof pageFetch({})).toBe('function');
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('Tue, 27 Oct 2026 12:00:10 GMT', Date.parse('2026-10-27T12:00:00Z'))).toBe(10_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('ChatGptProvider', () => {
  it('reports a missing session as not-logged-in', async () => {
    const { fn } = fakeFetch([['/api/auth/session', () => json({})]]);
    const p = new ChatGptProvider({ fetch: fn, sleep: noSleep });
    await expect(p.getSession()).rejects.toMatchObject({ code: 'not-logged-in' });
  });

  it('pages through the list with auth + account headers and dedupes', async () => {
    const items = Array.from({ length: 150 }, (_, i) => ({
      id: `id-${i}`,
      title: `t${i}`,
      update_time: 1760000000 - i * 60,
      create_time: 1760000000 - i * 60,
    }));
    const { fn, calls } = fakeFetch([
      ['/api/auth/session', session],
      [
        '/backend-api/conversations',
        ({ url }) => {
          const offset = Number(new URL(url).searchParams.get('offset'));
          // page 2 repeats one item from page 1 (the list shifts while paging in real life)
          const slice = offset === 0 ? items.slice(0, 100) : [items[99]!, ...items.slice(100)];
          return json({ items: slice, total: 151, limit: 100, offset });
        },
      ],
    ]);
    const progress: number[] = [];
    const chats = await new ChatGptProvider({ fetch: fn, sleep: noSleep }).listChats((p) => progress.push(p.loaded));

    expect(chats).toHaveLength(150);
    expect(progress).toEqual([100, 150]);
    const listCall = calls.find((c) => c.url.includes('/conversations'))!;
    const headers = listCall.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(headers['ChatGPT-Account-ID']).toBe('acct-9');
    expect(listCall.url).toContain('is_archived=false');
  });

  it('ignores an understated total and keeps paging (live: total=101 with 200+ chats)', async () => {
    const all = Array.from({ length: 237 }, (_, i) => ({ id: `id-${i}`, title: `t${i}` }));
    const { fn, calls } = fakeFetch([
      ['/api/auth/session', session],
      ['/backend-api/conversations', ({ url }) => {
        const offset = Number(new URL(url).searchParams.get('offset'));
        return json({ items: all.slice(offset, offset + 100), total: 101, limit: 100, offset });
      }],
    ]);
    const chats = await new ChatGptProvider({ fetch: fn, sleep: noSleep }).listChats();
    expect(chats).toHaveLength(237);
    expect(calls.filter((c) => c.url.includes('/conversations')).length).toBe(3); // 100 + 100 + 37
  });

  it('stops if the server ignores offset (a full page of repeats)', async () => {
    const same = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}` }));
    const { fn, calls } = fakeFetch([
      ['/api/auth/session', session],
      ['/backend-api/conversations', () => json({ items: same, total: 9999 })],
    ]);
    expect(await new ChatGptProvider({ fetch: fn, sleep: noSleep }).listChats()).toHaveLength(100);
    expect(calls.filter((c) => c.url.includes('/conversations')).length).toBe(2);
  });

  it('stops paging on an empty page even if total is larger', async () => {
    const { fn } = fakeFetch([
      ['/api/auth/session', session],
      ['/backend-api/conversations', ({ url }) =>
        json({ items: url.includes('offset=0&') ? [{ id: 'a' }] : [], total: 999 })],
    ]);
    expect(await new ChatGptProvider({ fetch: fn, sleep: noSleep }).listChats()).toHaveLength(1);
  });

  it('flags an unexpected list shape as bad-response', async () => {
    const { fn } = fakeFetch([
      ['/api/auth/session', session],
      ['/backend-api/conversations', () => json({ conversations: [] })],
    ]);
    await expect(new ChatGptProvider({ fetch: fn, sleep: noSleep }).listChats()).rejects.toMatchObject({
      code: 'bad-response',
    });
  });

  it('archives with is_archived and deletes with is_visible=false', async () => {
    const { fn, calls } = fakeFetch([
      ['/api/auth/session', session],
      ['/backend-api/conversation/', () => json({ success: true })],
    ]);
    const p = new ChatGptProvider({ fetch: fn, sleep: noSleep });
    await p.apply('archive', 'abc');
    await p.apply('delete', 'abc');
    const patches = calls.filter((c) => c.init?.method === 'PATCH');
    expect(patches.map((c) => c.url)).toEqual([
      'https://chatgpt.com/backend-api/conversation/abc',
      'https://chatgpt.com/backend-api/conversation/abc',
    ]);
    expect(patches.map((c) => JSON.parse(String(c.init!.body)))).toEqual([{ is_archived: true }, { is_visible: false }]);
  });

  it('refreshes the token once on 401, then gives up with unauthorized', async () => {
    let sessions = 0;
    const { fn } = fakeFetch([
      ['/api/auth/session', () => (sessions++, session())],
      ['/backend-api/conversation/', () => json({ detail: 'expired' }, 401)],
    ]);
    const err = await new ChatGptProvider({ fetch: fn, sleep: noSleep }).apply('archive', 'x').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe('unauthorized');
    expect(sessions).toBe(2);
  });

  it('maps 429 with Retry-After, 404 and 5xx', async () => {
    const statuses = [
      json({}, 429, { 'retry-after': '7' }),
      json({}, 404),
      json({}, 502),
    ];
    const { fn } = fakeFetch([
      ['/api/auth/session', session],
      ['/backend-api/conversation/', () => statuses.shift()!],
    ]);
    const p = new ChatGptProvider({ fetch: fn, sleep: noSleep });
    await expect(p.apply('delete', 'a')).rejects.toMatchObject({ code: 'rate-limited', retryAfterMs: 7000 });
    await expect(p.apply('delete', 'a')).rejects.toMatchObject({ code: 'not-found' });
    await expect(p.apply('delete', 'a')).rejects.toMatchObject({ code: 'server', status: 502 });
  });

  it('treats { success: false } as a failure', async () => {
    const { fn } = fakeFetch([
      ['/api/auth/session', session],
      ['/backend-api/conversation/', () => json({ success: false })],
    ]);
    await expect(new ChatGptProvider({ fetch: fn, sleep: noSleep }).apply('archive', 'a')).rejects.toMatchObject({
      code: 'bad-response',
    });
  });

  it('maps a thrown fetch to network', async () => {
    const p = new ChatGptProvider({
      fetch: async (url) => (url.includes('session') ? session() : Promise.reject(new TypeError('offline'))),
      sleep: noSleep,
    });
    await expect(p.apply('archive', 'a')).rejects.toMatchObject({ code: 'network' });
  });
});
