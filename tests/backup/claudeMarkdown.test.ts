import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildBackupZip } from '../../src/backup/archive';
import { claudeToMarkdown, claudeVisibleBranch, type ClaudeRawConversation } from '../../src/backup/claudeMarkdown';
import { chat } from '../helpers';

const ID = '1b2c3d4e-0000-4000-8000-000000000001';
const ROOT = '00000000-0000-4000-8000-000000000000';

/** Synthetic: m2 was retried, so m2a/m3a are an abandoned branch; the leaf is m4. */
const conv: ClaudeRawConversation = {
  uuid: ID,
  name: 'Sourdough timing',
  created_at: '2026-10-20T08:00:00.000000+00:00',
  updated_at: '2026-10-21T09:30:00.000000+00:00',
  current_leaf_message_uuid: 'm4',
  chat_messages: [
    { uuid: 'm1', index: 0, sender: 'human', parent_message_uuid: ROOT, content: [{ type: 'text', text: 'How long to proof?' }], attachments: [], files: [] },
    { uuid: 'm2a', index: 1, sender: 'assistant', parent_message_uuid: 'm1', content: [{ type: 'text', text: 'ABANDONED ANSWER' }] },
    { uuid: 'm3a', index: 2, sender: 'human', parent_message_uuid: 'm2a', content: [{ type: 'text', text: 'ABANDONED FOLLOW-UP' }] },
    {
      uuid: 'm2',
      index: 1,
      sender: 'assistant',
      parent_message_uuid: 'm1',
      content: [
        { type: 'thinking', text: 'SECRET THOUGHTS' },
        { type: 'tool_use', name: 'web_search' },
        { type: 'tool_result' },
        { type: 'text', text: 'About **4 hours** at room temperature.' },
      ],
    },
    {
      uuid: 'm3',
      index: 2,
      sender: 'human',
      parent_message_uuid: 'm2',
      content: [{ type: 'text', text: 'Here is my recipe' }],
      attachments: [{ file_name: 'recipe.txt' }],
      files_v2: [{ file_name: 'loaf.jpg' }],
    },
    { uuid: 'm4', index: 3, sender: 'assistant', parent_message_uuid: 'm3', text: 'Old-shape plain text answer.', content: [] },
  ],
};

describe('claudeToMarkdown', () => {
  const md = claudeToMarkdown(conv, ID);

  it('follows the current leaf, not retried branches', () => {
    expect(claudeVisibleBranch(conv).map((m) => m.uuid)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(md).not.toContain('ABANDONED');
  });

  it('renders turns in order, leaves out thinking and tool traffic, lists attachments', () => {
    expect(md.match(/^### /gm)).toEqual(['### ', '### ', '### ', '### ']);
    expect(md).toContain('### You\n\nHow long to proof?');
    expect(md).toContain('### Claude\n\nAbout **4 hours** at room temperature.');
    expect(md).toContain('_[attached: recipe.txt]_\n_[attached: loaf.jpg]_');
    expect(md).toContain('Old-shape plain text answer.');
    expect(md).not.toContain('SECRET THOUGHTS');
    expect(md).not.toContain('web_search');
    expect(md.indexOf('How long')).toBeLessThan(md.indexOf('4 hours'));
  });

  it('has a header with title, dates and link', () => {
    expect(md.startsWith('# Sourdough timing\n')).toBe(true);
    expect(md).toContain('- Created: 2026-10-20T08:00:00.000Z');
    expect(md).toContain(`- Link: https://claude.ai/chat/${ID}`);
  });

  it('without a leaf pointer, falls back to message order', () => {
    const flat = claudeVisibleBranch({ chat_messages: [{ uuid: 'b', index: 1 }, { uuid: 'a', index: 0 }] });
    expect(flat.map((m) => m.uuid)).toEqual(['a', 'b']);
    expect(claudeToMarkdown({}, 'x')).toContain('_No visible messages._');
  });

  it('is used for Claude chats in the backup zip', () => {
    const c = chat({ id: ID, provider: 'claude', title: 'Sourdough timing' });
    const files = unzipSync(buildBackupZip('claude', [{ chat: c, raw: conv }], new Date('2026-10-27T12:00:00Z')));
    const mdName = Object.keys(files).find((n) => n.endsWith('.md'))!;
    expect(strFromU8(files[mdName]!)).toContain('About **4 hours**');
  });
});
