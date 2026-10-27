/** Small helpers shared by every provider adapter. */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Accepts ISO strings, epoch seconds (float) or epoch milliseconds. Returns ISO or '' if unusable. */
export function toIso(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return toIso(asNumber);
    const t = Date.parse(value);
    return Number.isNaN(t) ? '' : new Date(t).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value < 1e11 ? value * 1000 : value; // seconds vs milliseconds
    return new Date(ms).toISOString();
  }
  return '';
}

export function parseRetryAfter(header: string | null, nowMs = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

/**
 * In Chromium, a content script's fetch already runs as the page (same origin, page cookies).
 * In Firefox it runs with the extension's principal; `content.fetch` is the page-context variant.
 */
export function pageFetch(scope: unknown = globalThis): FetchLike {
  const firefoxContent = (scope as { content?: { fetch?: typeof fetch } }).content;
  if (firefoxContent && typeof firefoxContent.fetch === 'function') {
    const f = firefoxContent.fetch;
    return (input, init) => f.call(firefoxContent, input, init);
  }
  return (input, init) => fetch(input, init);
}

export const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
