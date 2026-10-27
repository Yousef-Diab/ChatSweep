/**
 * End-to-end: the real built extension in real Chromium, with chatgpt.com mocked at the network
 * layer. Verifies the whole path: side panel → content script → (mock) ChatGPT API → job runner
 * in the background worker → progress back in the UI.
 */
import { chromium, expect, test, type BrowserContext, type Route } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const EXT = path.resolve('.output/chrome-mv3');
const DAY = 86_400_000;
const NOW = Date.now();

interface FakeChat {
  id: string;
  title: string;
  create_time: string;
  update_time: string;
  gizmo_id: string | null;
  is_archived: boolean;
}

// 45 chats, chat i last active i days ago. #35 has a protected title, #40 lives in a Project.
const CHATS: FakeChat[] = Array.from({ length: 45 }, (_, i) => ({
  id: `conv-${String(i).padStart(2, '0')}`,
  title: i === 35 ? 'Passport keep-me' : `Chat number ${i}`,
  create_time: new Date(NOW - (i + 1) * DAY).toISOString(),
  update_time: new Date(NOW - i * DAY).toISOString(),
  gizmo_id: i === 40 ? 'g-p-project1' : null,
  is_archived: false,
}));

interface Patch {
  id: string;
  body: Record<string, unknown>;
  status: number;
  auth: string | undefined;
  account: string | undefined;
}

async function mockChatGpt(context: BrowserContext, patches: Patch[]) {
  let rateLimitedOnce = false;
  const live = new Map(CHATS.map((c) => [c.id, { ...c }]));

  await context.route('https://chatgpt.com/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });

    if (url.pathname === '/api/auth/session') {
      return json({ accessToken: 'fake-token', account: { id: 'acct-123' }, user: { email: 'tester@example.com' } });
    }
    if (url.pathname === '/backend-api/conversations') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 28);
      const visible = [...live.values()].filter((c) => !c.is_archived);
      return json({ items: visible.slice(offset, offset + limit), total: visible.length, limit, offset });
    }
    const m = url.pathname.match(/^\/backend-api\/conversation\/([^/]+)$/);
    if (m && req.method() === 'GET') {
      const id = decodeURIComponent(m[1]!);
      const c = CHATS.find((x) => x.id === id);
      if (!c) return json({ detail: 'not found' }, 404);
      return json({
        title: c.title,
        create_time: Date.parse(c.create_time) / 1000,
        update_time: Date.parse(c.update_time) / 1000,
        current_node: 'n2',
        mapping: {
          n1: { id: 'n1', parent: null, children: ['n2'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: [`Question in ${id}`] } } },
          n2: { id: 'n2', parent: 'n1', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['An answer.'] } } },
        },
      });
    }
    if (m && req.method() === 'PATCH') {
      const id = decodeURIComponent(m[1]!);
      const body = JSON.parse(req.postData() ?? '{}');
      const headers = req.headers();
      // First PATCH of conv-31 is rate-limited, to exercise the retry path.
      if (id === 'conv-31' && !rateLimitedOnce) {
        rateLimitedOnce = true;
        patches.push({ id, body, status: 429, auth: headers.authorization, account: headers['chatgpt-account-id'] });
        return json({ detail: 'slow down' }, 429, { 'retry-after': '1' });
      }
      patches.push({ id, body, status: 200, auth: headers.authorization, account: headers['chatgpt-account-id'] });
      const chat = live.get(id);
      if (chat && body.is_archived === true) chat.is_archived = true;
      if (chat && body.is_visible === false) live.delete(id);
      return json({ success: true });
    }
    // Any page navigation: a blank stand-in for the ChatGPT app.
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><h1>Fake ChatGPT</h1></body></html>' });
  });
}

test('rules → preview → archive sweep → delete sweep, end to end', async () => {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const patches: Patch[] = [];
  await mockChatGpt(context, patches);

  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;

    const chatgpt = await context.newPage();
    await chatgpt.goto('https://chatgpt.com/');
    await expect(chatgpt.getByRole('heading', { name: 'Fake ChatGPT' })).toBeVisible();

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    // First run: the data-use notice must be accepted before anything talks to the provider.
    await panel.getByRole('button', { name: 'I agree, continue' }).click();

    // Connection through the content script, using the mocked session.
    await expect(panel.getByText('tester@example.com')).toBeVisible({ timeout: 15_000 });

    // Load chats.
    await panel.getByRole('button', { name: 'Load chats' }).click();
    await expect(panel.getByText('45', { exact: true })).toBeVisible();

    // Defaults: keep latest 30, projects protected → 45 - 30 - 1 (project) = 14 to sweep.
    await expect(panel.getByRole('button', { name: 'Archive 14 chats' })).toBeVisible();

    // Scheduled check, run on demand: queues a review (and never sweeps).
    await panel.getByRole('button', { name: 'Check now' }).click();
    await expect(panel.getByRole('status')).toContainText('14 chats match your rules');
    expect(patches).toHaveLength(0);
    // Regression: a background check must not leave the panel stuck in "Loading chats…".
    await expect(panel.getByRole('button', { name: 'Refresh' })).toBeEnabled();

    // Presets: "Fresh start" keeps latest 10 (+7 days) → 45 - 10 - 1 project = 34; back to Balanced → 14.
    await panel.getByLabel('Preset').selectOption({ label: 'Fresh start: keep latest 10 + last 7 days' });
    await expect(panel.getByRole('button', { name: 'Archive 34 chats' })).toBeVisible();
    await panel.getByLabel('Preset').selectOption({ label: 'Balanced: keep latest 30' });
    await expect(panel.getByRole('button', { name: 'Archive 14 chats' })).toBeVisible();

    // Add a title protection → 13.
    await panel.getByPlaceholder(/invoice/).fill('keep-me');
    await expect(panel.getByRole('button', { name: 'Archive 13 chats' })).toBeVisible();

    // Preview shows reasons.
    await panel.getByRole('button', { name: /^Keep 32$/ }).click();
    await expect(panel.getByText('Title matches "keep-me"')).toBeVisible();
    await expect(panel.getByText('Inside a project')).toBeVisible();
    await panel.setViewportSize({ width: 400, height: 900 });
    await panel.screenshot({ path: 'test-results/sidepanel-preview.png', fullPage: true });
    await panel.screenshot({ path: 'test-results/sidepanel-viewport.png' });

    // Archive (the default action), with a simple confirmation.
    await panel.getByRole('button', { name: 'Archive 13 chats' }).click();
    await panel.getByRole('button', { name: 'Yes, archive 13' }).click();
    await expect(panel.getByRole('heading', { name: 'Done' })).toBeVisible({ timeout: 45_000 });
    await expect(panel.getByText(/13 archived/)).toBeVisible();
    await expect(panel.getByRole('status')).toHaveCount(0); // starting the sweep cleared the queued review

    const ok = patches.filter((p) => p.status === 200);
    const expected = CHATS.slice(30)
      .filter((c) => c.id !== 'conv-35' && c.id !== 'conv-40')
      .map((c) => c.id)
      .sort();
    expect(ok.map((p) => p.id).sort()).toEqual(expected);
    expect(new Set(ok.map((p) => p.id)).size).toBe(13); // each chat exactly once
    expect(ok.every((p) => p.body.is_archived === true && Object.keys(p.body).length === 1)).toBe(true);
    expect(ok.every((p) => p.auth === 'Bearer fake-token' && p.account === 'acct-123')).toBe(true);
    expect(patches.filter((p) => p.status === 429).map((p) => p.id)).toEqual(['conv-31']); // retried after 429

    // Swept chats leave the cache: 45 - 13 = 32 remain, nothing left to sweep.
    await panel.getByRole('button', { name: 'Dismiss' }).click();
    await expect(panel.getByText('32', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Archive 0 chats' })).toBeDisabled();

    // Delete path: keep latest 29 → conv-29 becomes sweepable. Delete requires typing the count.
    await panel.getByLabel('Keep latest chats').fill('29');
    await panel.getByLabel('Action').selectOption('delete');
    await panel.getByRole('button', { name: 'Delete 1 chat' }).click();
    const confirm = panel.getByRole('button', { name: 'Yes, delete 1' });
    await expect(confirm).toBeDisabled();
    await panel.getByPlaceholder('1', { exact: true }).fill('1');
    // Backup is ON by default for deletes: a zip is downloaded before anything is deleted.
    await expect(panel.getByLabel(/Download a backup first/)).toBeChecked();
    const download = panel.waitForEvent('download');
    await confirm.click();
    const zipPath = await (await download).path();
    await expect(panel.getByRole('heading', { name: 'Done' })).toBeVisible({ timeout: 20_000 });

    const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
    const names = Object.keys(files);
    const md = names.find((n) => n.endsWith('.md'))!;
    expect(md).toMatch(/markdown\/001-chat-number-29-conv-29\.md$/);
    expect(strFromU8(files[md]!)).toContain('Question in conv-29');
    expect(names.some((n) => n.endsWith('json/conv-29.json'))).toBe(true);

    const deletes = patches.filter((p) => p.body.is_visible === false);
    expect(deletes.map((p) => p.id)).toEqual(['conv-29']);
  } finally {
    await context.close();
  }
});
