import { describe, expect, it } from 'vitest';
import { alarmName, badgeFor, countSweepable, periodMinutes } from '../../src/core/schedule';
import { DEFAULT_RULES } from '../../src/core/types';
import { NOW, chat } from '../helpers';

describe('schedule helpers', () => {
  it('period is whole days in minutes, at least one day', () => {
    expect(periodMinutes({ enabled: true, everyDays: 7 })).toBe(10080);
    expect(periodMinutes({ enabled: true, everyDays: 0 })).toBe(1440);
  });

  it('alarm names are per provider', () => {
    expect(alarmName('chatgpt')).toBe('chatsweep:schedule:chatgpt');
  });

  it('counts what the saved rules and overrides would sweep', () => {
    const chats = Array.from({ length: 40 }, (_, i) => chat({ daysAgo: i + 1 }));
    expect(countSweepable(chats, DEFAULT_RULES, {}, NOW)).toBe(10);
    expect(countSweepable(chats, DEFAULT_RULES, { [chats[39]!.id]: 'keep' }, NOW)).toBe(9);
  });

  it('badge shows a count, nothing for zero, "!" for problems', () => {
    expect(badgeFor(null).text).toBe('');
    expect(badgeFor({ provider: 'chatgpt', status: 'ready', checkedAt: 0, count: 0, action: 'archive' }).text).toBe('');
    expect(badgeFor({ provider: 'chatgpt', status: 'ready', checkedAt: 0, count: 42, action: 'archive' }).text).toBe('42');
    expect(badgeFor({ provider: 'chatgpt', status: 'ready', checkedAt: 0, count: 5000, action: 'archive' }).text).toBe('999+');
    expect(badgeFor({ provider: 'chatgpt', status: 'needs-tab', checkedAt: 0 }).text).toBe('!');
    expect(badgeFor({ provider: 'chatgpt', status: 'error', checkedAt: 0, message: 'x' }).text).toBe('!');
  });
});
