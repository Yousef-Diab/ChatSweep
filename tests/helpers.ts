import type { ChatMeta } from '../src/core/types';

export const NOW = new Date('2026-10-27T12:00:00Z');

export function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

let seq = 0;
export function chat(partial: Partial<ChatMeta> & { daysAgo?: number } = {}): ChatMeta {
  seq += 1;
  const { daysAgo: d = seq, ...rest } = partial;
  return {
    id: `c${String(seq).padStart(4, '0')}`,
    provider: 'chatgpt',
    title: `Chat ${seq}`,
    createdAt: daysAgo(d + 1),
    updatedAt: daysAgo(d),
    ...rest,
  };
}
