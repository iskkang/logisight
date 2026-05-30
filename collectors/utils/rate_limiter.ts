// collectors/utils/rate_limiter.ts
// Per-domain rate limiter â€” prevents hammering the same host repeatedly.
// Usage: await rateLimited('https://example.com/feed', () => fetch(...))

const lastRequestAt = new Map<string, number>();

const MIN_DELAY_MS = 1500; // minimum gap between requests to the same domain

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function rateLimited<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const domain = extractDomain(url);
  const last = lastRequestAt.get(domain) ?? 0;
  const elapsed = Date.now() - last;

  if (elapsed < MIN_DELAY_MS) {
    await sleep(MIN_DELAY_MS - elapsed);
  }

  lastRequestAt.set(domain, Date.now());
  return fn();
}
