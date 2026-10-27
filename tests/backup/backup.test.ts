import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import conversation from '../fixtures/chatgpt/conversation.synthetic.json';
import { buildBackupZip, fetchForBackup, slugify } from '../../src/backup/archive';
import { chatGptToMarkdown, visibleBranch } from '../../src/backup/chatgptMarkdown';
import { ProviderError } from '../../src/providers/types';
import { chat } from '../helpers';

const ID = '6720a1b2-0000-4000-8000-000000000001';

describe('chatGptToMarkdown', () => {
  const md = chatGptToMarkdown(conversation, ID);

  it('follows the current branch, not regenerated siblings', () => {
    expect(visibleBranch(conversation).map((n) => n.id)).toEqual(['root', 'n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    expect(md).not.toContain('OLD REGENERATED ANSWER');
  });

  it('renders user/assistant turns in order, with images and code', () => {
    const youIdx = md.indexOf('### You');
    expect(youIdx).toBeGreaterThan(0);
    expect(md).toContain('_[image]_\n\nHow long to walk to the Monastery?');
    expect(md).toContain('About **45 minutes** from the Treasury.');
    expect(md).toContain("```python\nprint('walk')\n```");
    expect(md.indexOf('45 minutes')).toBeLessThan(md.indexOf('Show me as code'));
  });

  it('skips hidden system messages, thoughts and tool output', () => {
    expect(md).not.toContain('### system');
    expect(md).not.toContain('### python');
    expect(md).not.toMatch(/\b42\b/);
    expect(md.match(/^### /gm)).toHaveLength(4);
  });

  it('has a header with title, dates and link', () => {
    expect(md.startsWith('# Trip planning: Petra\n')).toBe(true);
    expect(md).toContain('- Created: 2025-10-26T08:15:00.123Z');
    expect(md).toContain(`https://chatgpt.com/c/${ID}`);
  });

  it('falls back to the newest branch when current_node is missing', () => {
    const { current_node: _drop, ...noCurrent } = conversation;
    const ids = visibleBranch(noCurrent).map((n) => n.id);
    expect(ids.slice(0, 4)).toEqual(['root', 'n0', 'n1', 'n2']); // last child of n1 is n2
    expect(ids.at(-1)).toBe('n6');
  });

  it('survives an empty / broken conversation', () => {
    expect(chatGptToMarkdown({}, 'x')).toContain('_No visible messages._');
    const loop = { current_node: 'a', mapping: { a: { id: 'a', parent: 'b' }, b: { id: 'b', parent: 'a' } } };
    expect(visibleBranch(loop)).toHaveLength(2);
  });
});

describe('slugify', () => {
  it('makes safe file names', () => {
    expect(slugify('Trip planning: Petra!')).toBe('trip-planning-petra');
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
    expect(slugify('مرحبا بالعالم')).toBe('مرحبا-بالعالم');
    expect(slugify('***')).toBe('untitled');
    expect(slugify('a'.repeat(80)).length).toBe(50);
  });
});

describe('buildBackupZip', () => {
  it('contains README, index, markdown and raw json per chat', () => {
    const c = { ...chat({ title: 'Trip planning: Petra' }), id: ID };
    const zip = buildBackupZip('chatgpt', [{ chat: c, raw: conversation }], new Date('2026-10-27T12:00:00Z'));
    const files = unzipSync(zip);
    const names = Object.keys(files).sort();
    expect(names).toEqual([
      'chatsweep-backup-2026-10-27/README.txt',
      'chatsweep-backup-2026-10-27/index.json',
      `chatsweep-backup-2026-10-27/json/${ID}.json`,
      'chatsweep-backup-2026-10-27/markdown/001-trip-planning-petra-6720a1b2.md',
    ]);
    const index = JSON.parse(strFromU8(files['chatsweep-backup-2026-10-27/index.json']!));
    expect(index).toMatchObject({ provider: 'chatgpt', count: 1, chats: [{ id: ID, title: 'Trip planning: Petra' }] });
    expect(JSON.parse(strFromU8(files[`chatsweep-backup-2026-10-27/json/${ID}.json`]!))).toEqual(conversation);
  });
});

describe('fetchForBackup', () => {
  it('fetches in order with a delay, retrying rate limits', async () => {
    const chats = [chat(), chat(), chat()];
    const sleeps: number[] = [];
    const progress: number[] = [];
    let calls = 0;
    const entries = await fetchForBackup(chats, {
      fetchRaw: async (id) => {
        calls++;
        if (calls === 2) throw new ProviderError('rate-limited', 'slow', 429, 1000);
        return { id };
      },
      sleep: async (ms) => void sleeps.push(ms),
      onProgress: (d) => progress.push(d),
      delayMs: 300,
    });
    expect(entries.map((e) => (e.raw as { id: string }).id)).toEqual(chats.map((c) => c.id));
    expect(sleeps).toEqual([300, 1250, 300]);
    expect(progress).toEqual([1, 2, 3]);
  });

  it('aborts on a non-retryable failure, naming the chat', async () => {
    const c = chat({ title: 'Important' });
    await expect(
      fetchForBackup([c], {
        fetchRaw: async () => {
          throw new ProviderError('bad-response', 'weird');
        },
        sleep: async () => {},
      }),
    ).rejects.toThrow(/Important.*weird/);
  });
});
