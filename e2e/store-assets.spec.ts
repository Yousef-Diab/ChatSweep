/**
 * Generates Chrome Web Store / AMO assets from the real built extension against mocked sites:
 *   store/screenshots/1-preview.png … (1280×800)   store/promo-small-440x280.png
 * Skipped in normal runs. Generate with:  npm run store:assets
 */
import { chromium, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

test.skip(!process.env.STORE_ASSETS, 'set STORE_ASSETS=1 (npm run store:assets)');

const EXT = path.resolve('.output/chrome-mv3');
const OUT = path.resolve('store');
const DAY = 86_400_000;
const NOW = Date.now();

const TITLES = [
  'Weekly meal plan ideas', 'Fix flaky Playwright test', 'Invoice template for clients', 'Explain Rust lifetimes',
  'Trip planning: Petra', 'Birthday gift ideas for dad', 'SQL query for monthly totals', 'Rewrite cover letter',
  'Passport renewal checklist', 'Summarize this article', 'Regex for email validation', 'Workout plan, 3 days a week',
  'Translate menu to Arabic', 'Docker compose for Postgres', 'Tax 2025 deductions', 'Name ideas for a coffee shop',
  'CSS grid vs flexbox', 'Bedtime story about a dragon', 'Compare two laptops', 'Debug React useEffect loop',
  'Hello', 'New chat', 'Quick question', 'Convert 5 miles to km', 'Python list comprehension',
  'Plant care: monstera', 'Write a haiku about rain', 'Email to landlord', 'Learn Spanish basics', 'Budget spreadsheet formulas',
  'What is a mutex?', 'Recipe with chickpeas', 'Git rebase vs merge', 'Wedding speech draft', 'Car maintenance schedule',
  'Shorten this paragraph', 'Ideas for a side project', 'Explain OAuth simply', 'Invoice #1042 follow-up', 'Packing list for Iceland',
  'Fix my resume bullet points', 'How do vaccines work', 'Kubernetes pod keeps restarting', 'Chess opening for beginners', 'Test',
  'Brainstorm blog titles', 'Calculate mortgage payment', 'Story outline: sci-fi', 'Poem for mom', 'Sort algorithm comparison',
];

const chatgptItems = TITLES.map((title, i) => ({
  id: `c-${i}`,
  title,
  create_time: new Date(NOW - (i * 3 + 2) * DAY).toISOString(),
  update_time: new Date(NOW - i * 3 * DAY).toISOString(),
  gizmo_id: i === 4 || i === 17 ? 'g-p-travel' : null,
  is_archived: false,
  is_starred: i === 12,
}));

async function mock(context: BrowserContext) {
  await context.route('https://chatgpt.com/**', (route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname === '/api/auth/session') return json({ accessToken: 't', user: { email: 'you@example.com' } });
    if (url.pathname === '/backend-api/conversations') {
      const o = Number(url.searchParams.get('offset') ?? 0);
      return json({ items: chatgptItems.slice(o, o + 100), total: chatgptItems.length });
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><body>ChatGPT</body></html>' });
  });
  await context.route('https://claude.ai/**', (route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname === '/api/organizations') return json([{ uuid: 'org', name: 'Personal', capabilities: ['chat'] }]);
    if (url.pathname.endsWith('/chat_conversations')) {
      const o = Number(url.searchParams.get('offset') ?? 0);
      const items = TITLES.slice(0, 44).map((name, i) => ({
        uuid: `k-${i}`,
        name,
        created_at: new Date(NOW - (i * 4 + 1) * DAY).toISOString(),
        updated_at: new Date(NOW - i * 4 * DAY).toISOString(),
        is_starred: i === 8,
        is_archived: false,
        is_temporary: false,
        project: i === 13 ? { uuid: 'p' } : null,
      }));
      return json(items.slice(o, o + 100));
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><body>Claude</body></html>' });
  });
}

/** Presents unaltered captures of the built UI on a store-sized canvas. */
async function compose(stage: Page, shots: Buffer[], headline: string, points: string[], file: string, index: string) {
  const images = shots.map((shot, i) => {
    // The translucent sticky footer can pick up a few pixels of the list behind its top edge.
    const trim = file === '3-confirm.png' && i === 1 ? 8 : 0;
    return `<div style="overflow:hidden;border:1px solid #d4d4d8;border-radius:12px;box-shadow:0 18px 46px rgba(4,47,46,.16)"><img src="data:image/png;base64,${shot.toString('base64')}" style="width:100%;display:block;margin-top:-${trim}px"></div>`;
  }).join('');
  await stage.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;box-sizing:border-box;
    display:flex;align-items:center;gap:36px;padding:48px 76px;font-family:'Segoe UI',system-ui,sans-serif;
    background:radial-gradient(circle at 78% 22%,#99f6e4 0,transparent 36%),linear-gradient(135deg,#f8fffd,#d1faf2 72%,#b8f2e7);color:#134e4a">
    <div style="width:570px;flex:none;position:relative">
      <div style="font-size:19px;font-weight:700;color:#0f766e;letter-spacing:.02em">ChatSweep <span style="color:#5d9f96;font-weight:400;margin-left:14px">/ ${index}</span></div>
      <div style="width:54px;height:4px;border-radius:9px;background:#0d9488;margin:30px 0 24px"></div>
      <h1 style="font-size:48px;line-height:1.08;letter-spacing:-.035em;margin:0 0 28px;color:#042f2e">${headline}</h1>
      <ul style="list-style:none;font-size:21px;line-height:1.48;margin:0;padding:0;color:#285b55">${points.map((p) => `<li style="display:flex;gap:13px;margin:0 0 15px"><span style="color:#0d9488;font-weight:700">✓</span><span>${p}</span></li>`).join('')}</ul>
      <div style="font-size:13px;letter-spacing:.06em;color:#4c8d83;margin-top:30px;text-transform:uppercase">Your chats. Your rules. Your call.</div>
    </div>
    <div style="width:480px;flex:none;display:flex;flex-direction:column;gap:12px;justify-content:center;max-height:704px">${images}</div>
  </body></html>`);
  await stage.screenshot({ path: path.join(OUT, 'screenshots', file) });
}

test('store assets', async () => {
  mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await mock(context);
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;

    await (await context.newPage()).goto('https://chatgpt.com/');
    await (await context.newPage()).goto('https://claude.ai/');
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 420, height: 720 });
    await panel.emulateMedia({ colorScheme: 'light' });
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.getByRole('button', { name: 'I agree, continue' }).click();
    await panel.getByText('you@example.com').waitFor();
    await panel.getByRole('button', { name: 'Load chats' }).click();
    await panel.getByPlaceholder(/invoice/).fill('invoice\npassport\n/^tax \\d{4}/i');
    const stage = await context.newPage();
    await stage.setViewportSize({ width: 1280, height: 800 });

    // A complete rules view, ending at the card boundary rather than mid-section.
    await panel.getByLabel('Keep if active in last … days').fill('7');
    await panel.getByRole('heading', { name: 'Keep rules' }).click();
    const rulesBottom = await panel.getByRole('heading', { name: 'Keep rules' }).evaluate(
      (heading) => Math.ceil(heading.closest('section')!.getBoundingClientRect().bottom),
    );
    await compose(stage, [await panel.screenshot({ clip: { x: 0, y: 0, width: 420, height: rulesBottom + 6 } })],
      'Rules, not checkboxes', [
        'Keep your latest chats and recent activity',
        'Protect titles with words or /regex/',
        'Keep Projects and starred chats safe',
        'Preview the rest before you act',
      ], '1-rules.png', '01 / SET YOUR RULES');

    // Narrow the real preview to a useful mix of protected and swept titles.
    await panel.getByLabel('Keep latest chats').fill('4');
    await panel.getByLabel('Keep if active in last … days').fill('7');
    const preview = panel.locator('section').filter({ has: panel.getByRole('heading', { name: 'Preview' }) });
    await preview.getByRole('button', { name: /^All \d+$/ }).click();
    await preview.getByPlaceholder('Search titles…').fill('ideas');
    await preview.getByRole('heading', { name: 'Preview' }).click();
    const previewShot = await preview.screenshot();
    await compose(stage, [previewShot], 'See why, before anything changes', [
      'Review Keep and Sweep decisions side by side',
      'See the reason behind each result',
      'Flip a choice or pin a chat to keep it',
      'Nothing changes until you confirm',
    ], '2-preview.png', '02 / REVIEW THE PLAN');

    // The confirmation state is captured separately from the preview: both are real UI.
    await panel.getByRole('button', { name: /^Archive \d+ chats$/ }).click();
    const confirmShot = await panel.locator('.sticky').screenshot({
      style: '.sticky { background-color: #fafafa !important; backdrop-filter: none !important; }',
    });
    await compose(stage, [previewShot, confirmShot], 'Safe by default', [
      'ChatGPT defaults to reversible Archive',
      'Delete requires typing the exact count',
      'Optional Markdown + JSON backup zip',
      'You remain in control of every sweep',
    ], '3-confirm.png', '03 / CONFIRM FIRST');
    await panel.getByRole('button', { name: 'Back' }).click();

    // Two authentic excerpts: provider/account state and its scheduling controls.
    await panel.getByRole('button', { name: 'Claude', exact: true }).click();
    await panel.getByText('Connected to Claude').waitFor();
    await panel.getByRole('button', { name: 'Load chats' }).click();
    const schedule = panel.locator('section').filter({ has: panel.getByRole('heading', { name: 'Scheduled check' }) });
    await schedule.getByRole('checkbox').check();
    await schedule.getByRole('button', { name: 'Check now' }).click();
    await panel.getByRole('status').waitFor();
    await panel.evaluate(() => window.scrollTo(0, 0));
    const accountBottom = await panel.locator('section').first().evaluate(
      (section) => Math.ceil(section.getBoundingClientRect().bottom),
    );
    const accountShot = await panel.screenshot({ clip: { x: 0, y: 0, width: 420, height: accountBottom + 5 } });
    // The action bar is sticky in the live panel; keep it out of this focused card excerpt.
    await panel.locator('.sticky').evaluate((bar: HTMLElement) => { bar.style.visibility = 'hidden'; });
    const scheduleShot = await schedule.screenshot();
    await panel.locator('.sticky').evaluate((bar: HTMLElement) => { bar.style.visibility = ''; });
    await compose(stage, [accountShot, scheduleShot], 'ChatGPT and Claude, one place', [
      'Separate rules for each chat history',
      'Scheduled checks count, never sweep',
      'Review and confirm every action yourself',
      'Local-only, with no tracking',
    ], '4-claude-schedule.png', '04 / STAY IN CONTROL');

    // Small promo tile, 440×280.
    const icon = readFileSync(path.resolve('public/icon/128.png')).toString('base64');
    await stage.setViewportSize({ width: 440, height: 280 });
    await stage.setContent(`<!doctype html><html><body style="margin:0;width:440px;height:280px;box-sizing:border-box;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:9px;font-family:'Segoe UI',system-ui,sans-serif;
      background:radial-gradient(circle at 85% 5%,#20b8a9,transparent 45%),linear-gradient(135deg,#115e59,#0d9488);color:#fff">
      <img src="data:image/png;base64,${icon}" style="width:76px;height:76px;filter:drop-shadow(0 7px 12px #064e3b66)">
      <div style="font-size:39px;font-weight:750;letter-spacing:-1px;line-height:1.1">ChatSweep</div>
      <div style="font-size:19px;font-weight:500;color:#e5fffa">Keep what matters. Sweep the rest.</div>
    </body></html>`);
    await stage.screenshot({ path: path.join(OUT, 'promo-small-440x280.png') });
  } finally {
    await context.close();
  }
});
