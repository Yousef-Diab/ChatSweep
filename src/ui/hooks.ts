import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { WxtStorageItem } from 'wxt/utils/storage';
import type { ProviderInfo } from '../providers/registry';

/** React binding for a WXT storage item; stays in sync across extension pages. */
export function useStorageItem<T>(item: WxtStorageItem<T, Record<string, unknown>>): [T | undefined, (v: T) => Promise<void>] {
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    item.getValue().then((v) => alive && setValue(v));
    const unwatch = item.watch((v) => setValue(v));
    return () => {
      alive = false;
      unwatch();
    };
  }, [item]);

  const set = useCallback(
    async (v: T) => {
      setValue(v);
      await item.setValue(v);
    },
    [item],
  );
  return [value, set];
}

export interface ProviderTab {
  id: number;
  title?: string;
  active: boolean;
}

/** Finds an open tab for the provider (preferring the active one) and tracks changes. */
export function useProviderTab(provider: ProviderInfo): { tab: ProviderTab | null; refresh: () => void } {
  const [tab, setTab] = useState<ProviderTab | null>(null);

  const refresh = useCallback(() => {
    browser.tabs
      .query({ url: provider.tabPattern })
      .then((tabs) => {
        const best = tabs.find((t) => t.active) ?? tabs[0];
        setTab(best?.id != null ? { id: best.id, title: best.title, active: !!best.active } : null);
      })
      .catch(() => setTab(null));
  }, [provider.tabPattern]);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    browser.tabs.onUpdated.addListener(onChange);
    browser.tabs.onRemoved.addListener(onChange);
    browser.tabs.onActivated.addListener(onChange);
    return () => {
      browser.tabs.onUpdated.removeListener(onChange);
      browser.tabs.onRemoved.removeListener(onChange);
      browser.tabs.onActivated.removeListener(onChange);
    };
  }, [refresh]);

  return { tab, refresh };
}
