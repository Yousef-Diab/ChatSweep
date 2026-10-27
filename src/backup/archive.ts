/**
 * Builds the backup zip and fetches conversations for it (throttled, with retries).
 *
 *   chatsweep-backup-2026-10-27/
 *     README.txt
 *     index.json                 metadata for every chat in the backup
 *     markdown/001-trip-planning-petra-6720a1b2.md
 *     json/6720a1b2-….json        raw provider response, untouched
 */
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { ChatMeta, ProviderId } from '../core/types';
import { backoffMs, DEFAULT_RUNNER_OPTIONS } from '../jobs/runner';
import { toErrorInfo } from '../providers/types';
import { chatGptToMarkdown, type RawConversation } from './chatgptMarkdown';
import { claudeToMarkdown, type ClaudeRawConversation } from './claudeMarkdown';

export interface BackupEntry {
  chat: ChatMeta;
  raw: unknown;
}

export function slugify(title: string, max = 50): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'untitled';
}

export function toMarkdown(provider: ProviderId, entry: BackupEntry): string {
  switch (provider) {
    case 'chatgpt':
      return chatGptToMarkdown(entry.raw as RawConversation, entry.chat.id);
    case 'claude':
      return claudeToMarkdown(entry.raw as ClaudeRawConversation, entry.chat.id);
    default:
      return `# ${entry.chat.title}\n\n(Markdown export not available for ${provider}; see the JSON file.)\n`;
  }
}

export function backupFolderName(now: Date): string {
  return `chatsweep-backup-${now.toISOString().slice(0, 10)}`;
}

export function buildBackupZip(provider: ProviderId, entries: readonly BackupEntry[], now: Date): Uint8Array {
  const root = backupFolderName(now);
  const files: Zippable = {};
  const width = Math.max(3, String(entries.length).length);

  const index = entries.map((e, i) => {
    const md = `markdown/${String(i + 1).padStart(width, '0')}-${slugify(e.chat.title)}-${e.chat.id.slice(0, 8)}.md`;
    const json = `json/${e.chat.id.replace(/[^\w-]/g, '_')}.json`;
    files[`${root}/${md}`] = strToU8(toMarkdown(provider, e));
    files[`${root}/${json}`] = strToU8(JSON.stringify(e.raw, null, 2));
    return { ...e.chat, files: { markdown: md, json } };
  });

  files[`${root}/index.json`] = strToU8(
    JSON.stringify({ provider, exportedAt: now.toISOString(), count: entries.length, chats: index }, null, 2),
  );
  files[`${root}/README.txt`] = strToU8(
    [
      `ChatSweep backup: ${entries.length} ${provider} chat(s), exported ${now.toISOString()}.`,
      '',
      'markdown/  readable copy of the visible conversation branch',
      'json/      the raw response from the provider, untouched',
      'index.json list of chats with their original ids and dates',
      '',
      'Created locally by the ChatSweep extension. Nothing was uploaded anywhere.',
    ].join('\n'),
  );

  return zipSync(files, { level: 6 });
}

export interface FetchAllDeps {
  fetchRaw(id: string): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  onProgress?(done: number, total: number): void;
  delayMs?: number;
  maxAttempts?: number;
}

/** Fetches every chat, one at a time. Throws on the first chat that cannot be fetched. */
export async function fetchForBackup(chats: readonly ChatMeta[], deps: FetchAllDeps): Promise<BackupEntry[]> {
  const delay = deps.delayMs ?? 400;
  const maxAttempts = deps.maxAttempts ?? 4;
  const out: BackupEntry[] = [];

  for (let i = 0; i < chats.length; i++) {
    const chat = chats[i]!;
    if (i > 0) await deps.sleep(delay);
    for (let attempt = 1; ; attempt++) {
      try {
        out.push({ chat, raw: await deps.fetchRaw(chat.id) });
        break;
      } catch (raw) {
        const err = toErrorInfo(raw);
        const retryable = err.code === 'rate-limited' || err.code === 'server' || err.code === 'network';
        if (!retryable || attempt >= maxAttempts) {
          throw new Error(`Backup failed on "${chat.title}": ${err.message}`);
        }
        await deps.sleep(backoffMs(attempt, err, DEFAULT_RUNNER_OPTIONS));
      }
    }
    deps.onProgress?.(i + 1, chats.length);
  }
  return out;
}
