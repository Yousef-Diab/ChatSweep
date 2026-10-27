import { describe, expect, it } from 'vitest';
import { defaultAction, effectiveAction, PROVIDER_LIST, PROVIDERS } from '../../src/providers/registry';

describe('default action', () => {
  it('archives where the provider supports it, deletes otherwise', () => {
    expect(defaultAction(PROVIDERS.chatgpt)).toBe('archive');
    expect(defaultAction(PROVIDERS.claude)).toBe('delete');
  });

  it('respects a saved preference but never picks archive where unsupported', () => {
    expect(effectiveAction(PROVIDERS.chatgpt, 'delete')).toBe('delete');
    expect(effectiveAction(PROVIDERS.chatgpt, null)).toBe('archive');
    expect(effectiveAction(PROVIDERS.claude, 'archive')).toBe('delete');
  });

  it('lists ChatGPT and Claude as available providers', () => {
    expect(PROVIDER_LIST.map((p) => p.id)).toEqual(['chatgpt', 'claude']);
  });
});
