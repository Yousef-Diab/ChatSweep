/**
 * Converts a raw Claude conversation (GET …/chat_conversations/{uuid}?tree=True&rendering_mode=messages)
 * to readable Markdown.
 *
 * With `tree=True` every edit/retry branch is returned; `current_leaf_message_uuid` marks the
 * branch the user last saw, and `parent_message_uuid` links each message to the one before it.
 * We export that branch, oldest first. Tool calls and "thinking" blocks are left out; the full
 * raw JSON is always saved next to the Markdown, so nothing is lost.
 */
import { toIso } from '../providers/shared';

export interface ClaudeRawBlock {
  type?: string;
  text?: string;
  name?: string;
}

export interface ClaudeRawMessage {
  uuid?: string;
  sender?: string;
  parent_message_uuid?: string | null;
  index?: number;
  created_at?: string;
  /** Older API shape: plain text instead of content blocks. */
  text?: string;
  content?: ClaudeRawBlock[];
  attachments?: Array<{ file_name?: string }>;
  files?: Array<{ file_name?: string }>;
  files_v2?: Array<{ file_name?: string }>;
}

export interface ClaudeRawConversation {
  uuid?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  current_leaf_message_uuid?: string | null;
  chat_messages?: ClaudeRawMessage[];
}

/** The visible branch, oldest first. Without a usable leaf pointer, falls back to message order. */
export function claudeVisibleBranch(conv: ClaudeRawConversation): ClaudeRawMessage[] {
  const msgs = (conv.chat_messages ?? []).filter((m) => m && typeof m === 'object');
  const byId = new Map(msgs.filter((m) => typeof m.uuid === 'string').map((m) => [m.uuid!, m]));
  const leaf = conv.current_leaf_message_uuid;

  if (leaf && byId.has(leaf)) {
    const path: ClaudeRawMessage[] = [];
    const seen = new Set<string>();
    let id: string | null | undefined = leaf;
    while (id && byId.has(id) && !seen.has(id)) {
      seen.add(id);
      path.push(byId.get(id)!);
      id = byId.get(id)!.parent_message_uuid;
    }
    return path.reverse();
  }
  return [...msgs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function blockToText(b: ClaudeRawBlock): string {
  switch (b.type) {
    case 'text':
      return b.text ?? '';
    case 'thinking':
    case 'redacted_thinking':
    case 'tool_use':
    case 'tool_result':
    case 'token_budget':
      return '';
    case 'image':
      return '_[image]_';
    default:
      return typeof b.text === 'string' ? b.text : `_[${b.type ?? 'content'}]_`;
  }
}

export function claudeMessageToMarkdown(msg: ClaudeRawMessage): string | null {
  const parts = Array.isArray(msg.content) && msg.content.length
    ? msg.content.map(blockToText)
    : [msg.text ?? ''];
  const files = [...(msg.attachments ?? []), ...(msg.files_v2 ?? msg.files ?? [])]
    .map((f) => f?.file_name)
    .filter((n): n is string => typeof n === 'string' && !!n.trim());
  if (files.length) parts.push(files.map((n) => `_[attached: ${n}]_`).join('\n'));

  const body = parts.filter((s) => s.trim()).join('\n\n').trim();
  if (!body) return null;
  const who = msg.sender === 'human' ? 'You' : msg.sender === 'assistant' ? 'Claude' : (msg.sender ?? 'Unknown');
  return `### ${who}\n\n${body}`;
}

export function claudeToMarkdown(conv: ClaudeRawConversation, id: string): string {
  const title = conv.name?.trim() || 'Untitled chat';
  const header = [
    `# ${title}`,
    '',
    `- Created: ${toIso(conv.created_at) || 'unknown'}`,
    `- Last active: ${toIso(conv.updated_at) || 'unknown'}`,
    `- Link: https://claude.ai/chat/${id}`,
  ].join('\n');

  const messages = claudeVisibleBranch(conv)
    .map(claudeMessageToMarkdown)
    .filter((m): m is string => m !== null);

  return `${header}\n\n---\n\n${messages.length ? messages.join('\n\n') : '_No visible messages._'}\n`;
}
