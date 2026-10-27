/**
 * End-to-end for Claude: the real built extension in real Chromium, with claude.ai mocked at the
 * network layer. Switch provider → connect → load → rules → delete (typed confirm + backup).
 * The mock follows the live shapes from spike/results/2026-10-27-claude-probe.json.
 */
import { chromium, expect, test, type BrowserContext, type Route } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const EXT = path.resolve('.output/chrome-mv3');
const DAY = 86_400_000;
const NOW = Date.now();
const ORG = 'org-personal-1';

// 40 chats, chat i last active i days ago. #33 is starred, #36 lives in a Project.
const CHATS = Array.from({ length: 40 }, (_, i) => ({
  uuid: `cl-${String(i).padStart(2, '0')}`,
  name: `Claude chat ${i}`,
  summary: '',
  created_at: new Date(NOW - (i + 1) * DAY).toISOString(),
  updated_at: new Date(NOW - i * DAY).toISOString(),
  is_starred: i === 33,
  is_archived: false,
  is_temporary: false,
  // Live shape: `project` is null or an object.
  project: i === 36 ? { uuid: 'proj-1', name: 'Project one' } : null,
}));

async function mockClaude(context: BrowserContext, deletes: string[], writes: string[]) {
  const live = new Map(CHATS.map((c) => [c.uuid, c]));
  await context.route('https://claude.ai/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/organizations') {
      return json([
        { uuid: 'org-api-only', name: 'API workspace', capabilities: ['api'] },
        { uuid: ORG, name: 'Personal plan', capabilities: ['chat', 'claude_pro'] },
      ]);
    }
    const base = `/api/organizations/${ORG}/chat_conversations`;
    if (url.pathname === base && req.method() === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return json([...live.values()].slice(offset, offset + limit));
    }
    const m = url.pathname.match(new RegExp(`^${base}/([^/]+)$`));
    if (m && req.method() === 'GET') {
      const id = decodeURIComponent(m[1]!);
      const c = CHATS.find((x) => x.uuid === id);
      if (!c) return json({ error: 'not found' }, 404);
      return json({
        ...c,
        current_leaf_message_uuid: 'm2',
        chat_messages: [
          { uuid: 'm1', index: 0, sender: 'human', parent_message_uuid: 'root', content: [{ type: 'text', text: `Question in ${id}` }] },
          { uuid: 'm2', index: 1, sender: 'assistant', parent_message_uuid: 'm1', content: [{ type: 'text', text: 'A Claude answer.' }] },
        ],
      });
    }
    if (m && req.method() === 'DELETE') {
      const id = decodeURIComponent(m[1]!);
      deletes.push(id);
      live.delete(id);
      return route.fulfill({ status: 204 });
    }
    if (req.method() !== 'GET') {
      writes.push(`${req.method()} ${url.pathname}`);
      return json({ error: 'unexpected' }, 400);
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><h1>Fake Claude</h1></body></html>' });
  });
}

test('claude: switch provider → load → delete with backup, end to end', async () => {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const deletes: string[] = [];
  const writes: string[] = [];
  await mockClaude(context, deletes, writes);

  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;

    const claude = await context.newPage();
    await claude.goto('https://claude.ai/');
    await expect(claude.getByRole('heading', { name: 'Fake Claude' })).toBeVisible();

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    // First run: the data-use notice must be accepted before anything talks to the provider.
    await panel.getByRole('button', { name: 'I agree, continue' }).click();
    await panel.getByRole('button', { name: 'Claude', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Claude', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Connected to the chat-capable org, not the API-only one.
    await expect(panel.getByText('Personal plan')).toBeVisible({ timeout: 15_000 });

    // No custom GPTs on Claude.
    await expect(panel.getByText('Always keep chats with custom GPTs')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Load chats' }).click();
    await expect(panel.getByText('40', { exact: true })).toBeVisible();

    // No archive on Claude: Delete is the only action.
    await expect(panel.getByLabel('Action').locator('option')).toHaveText(['Delete (permanent)']);

    // Defaults: keep latest 30, starred + projects protected → 40 - 30 - 2 = 8.
    await panel.getByRole('button', { name: 'Delete 8 chats' }).click();
    const confirm = panel.getByRole('button', { name: 'Yes, delete 8' });
    await expect(confirm).toBeDisabled();
    await panel.getByPlaceholder('8', { exact: true }).fill('8');
    await expect(panel.getByLabel(/Download a backup first/)).toBeChecked();
    const download = panel.waitForEvent('download');
    await confirm.click();
    const zipPath = await (await download).path();
    await expect(panel.getByRole('heading', { name: 'Done' })).toBeVisible({ timeout: 45_000 });
    await expect(panel.getByText(/8 deleted/)).toBeVisible();

    const expected = CHATS.slice(30)
      .filter((c) => !c.is_starred && !c.project)
      .map((c) => c.uuid)
      .sort();
    expect([...deletes].sort()).toEqual(expected);
    expect(new Set(deletes).size).toBe(8);
    expect(writes).toEqual([]); // nothing but DELETEs on the expected chats

    const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
    const mds = Object.keys(files).filter((n) => n.endsWith('.md'));
    expect(mds).toHaveLength(8);
    const one = strFromU8(files[mds.find((n) => n.includes('cl-30'))!]!);
    expect(one).toContain('Question in cl-30');
    expect(one).toContain('### Claude\n\nA Claude answer.');
    expect(one).toContain('https://claude.ai/chat/cl-30');

    // Switching back to ChatGPT shows its own (empty) state; the Claude cache is untouched.
    await panel.getByRole('button', { name: 'Dismiss' }).click();
    await panel.getByRole('button', { name: 'ChatGPT', exact: true }).click();
    await expect(panel.getByText('No ChatGPT tab open')).toBeVisible();
    await panel.getByRole('button', { name: 'Claude', exact: true }).click();
    await expect(panel.getByText('32', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
