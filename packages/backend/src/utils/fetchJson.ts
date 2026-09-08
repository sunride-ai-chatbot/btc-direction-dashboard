export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 10_000, retries = 2, retryDelayMs = 1_000, headers = {}, method = 'GET', body } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        method,
        body,
        headers: { accept: 'application/json', ...headers },
      });
      if (res.status === 429) {
        throw new RateLimitError(url);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const backoff = retryDelayMs * Math.pow(2, attempt);
        await sleep(err instanceof RateLimitError ? backoff * 3 : backoff);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 10_000, retries = 1, retryDelayMs = 1_000 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(retryDelayMs * Math.pow(2, attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export class RateLimitError extends Error {
  constructor(url: string) {
    super(`Rate limited by ${url}`);
    this.name = 'RateLimitError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
