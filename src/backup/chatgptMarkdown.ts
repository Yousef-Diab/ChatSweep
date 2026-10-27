/**
 * Converts a raw ChatGPT conversation (GET /backend-api/conversation/{id}) to readable Markdown.
 *
 * The conversation is a tree (`mapping`) because of edits/regenerations; the branch the user
 * last saw ends at `current_node`. We export exactly that branch, oldest message first.
 * Hidden system messages, tool traffic and model "thoughts" are left out; the full raw JSON
 * is always saved next to the Markdown, so nothing is lost.
 */
import { toIso } from '../providers/chatgpt';

interface RawNode {
  id?: string;
  parent?: string | null;
  children?: string[];
  message?: RawMessage | null;
}

interface RawMessage {
  author?: { role?: string; name?: string | null };
  create_time?: number | null;
  content?: { content_type?: string; parts?: unknown[]; text?: string; language?: string };
  metadata?: { is_visually_hidden_from_conversation?: boolean };
}

export interface RawConversation {
  title?: string;
  create_time?: unknown;
  update_time?: unknown;
  current_node?: string;
  mapping?: Record<string, RawNode>;
}

const SKIP_CONTENT = new Set([
  'thoughts',
  'reasoning_recap',
  'user_editable_context',
  'model_editable_context',
  'tether_browsing_display',
  'tether_quote',
  'system_error',
  'execution_output',
]);

/** The visible branch, root → current node. Falls back to following the last child from the root. */
export function visibleBranch(conv: RawConversation): RawNode[] {
  const mapping = conv.mapping ?? {};
  const path: RawNode[] = [];
  const seen = new Set<string>();

  let id: string | null | undefined = conv.current_node && mapping[conv.current_node] ? conv.current_node : undefined;
  if (id) {
    while (id && mapping[id] && !seen.has(id)) {
      seen.add(id);
      path.push(mapping[id]!);
      id = mapping[id]!.parent;
    }
    return path.reverse();
  }

  // No usable current_node: start at a root and keep taking the newest branch.
  const root = Object.entries(mapping).find(([, n]) => !n.parent || !mapping[n.parent]);
  id = root?.[0];
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id);
    path.push(mapping[id]!);
    const children: string[] = mapping[id]!.children ?? [];
    id = children[children.length - 1];
  }
  return path;
}

function partToText(part: unknown): string {
  if (typeof part === 'string') return part;
  if (part && typeof part === 'object') {
    const p = part as { content_type?: string; text?: string };
    if (p.content_type === 'audio_transcription' && typeof p.text === 'string') return p.text;
    if (p.content_type === 'image_asset_pointer') return '_[image]_';
    return `_[${p.content_type ?? 'attachment'}]_`;
  }
  return '';
}

export function messageToMarkdown(msg: RawMessage): string | null {
  const role = msg.author?.role;
  if (!role || role === 'system' || role === 'tool') return null;
  if (msg.metadata?.is_visually_hidden_from_conversation) return null;
  const content = msg.content ?? {};
  const type = content.content_type ?? 'text';
  if (SKIP_CONTENT.has(type)) return null;

  let body: string;
  if (type === 'code') {
    body = '```' + (content.language && content.language !== 'unknown' ? content.language : '') + '\n' + (content.text ?? '') + '\n```';
  } else if (Array.isArray(content.parts)) {
    body = content.parts.map(partToText).filter((s) => s.trim()).join('\n\n');
  } else {
    body = content.text ?? '';
  }
  if (!body.trim()) return null;

  const who = role === 'user' ? 'You' : role === 'assistant' ? 'ChatGPT' : role;
  return `### ${who}\n\n${body.trim()}`;
}

export function chatGptToMarkdown(conv: RawConversation, id: string): string {
  const title = conv.title?.trim() || 'Untitled chat';
  const created = toIso(conv.create_time);
  const updated = toIso(conv.update_time);
  const header = [
    `# ${title}`,
    '',
    `- Created: ${created || 'unknown'}`,
    `- Last active: ${updated || 'unknown'}`,
    `- Link: https://chatgpt.com/c/${id}`,
  ].join('\n');

  const messages = visibleBranch(conv)
    .map((n) => (n.message ? messageToMarkdown(n.message) : null))
    .filter((m): m is string => m !== null);

  return `${header}\n\n---\n\n${messages.length ? messages.join('\n\n') : '_No visible messages._'}\n`;
}
