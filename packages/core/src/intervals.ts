import { setTimeout as delay } from 'node:timers/promises';

export class UpstreamError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export interface ClientOptions {
  apiKey: string;
  athleteId: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRequest?: () => Promise<void>;
  onRateLimit?: (remaining: string | null, limit: string | null) => void;
}
export class IntervalsClient {
  private options: ClientOptions;
  constructor(options: ClientOptions) {
    this.options = options;
  }
  async get(path: string): Promise<unknown> {
    if (!this.options.apiKey) throw new UpstreamError('CREDENTIALS_NOT_CONFIGURED');
    const signal = AbortSignal.timeout(this.options.timeoutMs ?? 60000);
    const deadline = Date.now() + (this.options.timeoutMs ?? 60000);
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.options.onRequest?.();
      let response: Response;
      try {
        response = await (this.options.fetch ?? fetch)(`https://intervals.icu/api/v1${path}`, {
          signal,
          redirect: 'error',
          headers: {
            Authorization: `Basic ${Buffer.from(`API_KEY:${this.options.apiKey}`).toString('base64')}`,
            'User-Agent': 'RunningDataHub/0.1 (personal read-only importer)',
            Accept: 'application/json',
          },
        });
      } catch {
        if (signal.aborted) throw new UpstreamError('REQUEST_TIMEOUT');
        if (attempt === 3) throw new UpstreamError('NETWORK_ERROR');
        await (this.options.sleep ?? delay)(Math.min(2000, 250 * 2 ** attempt));
        continue;
      }
      this.options.onRateLimit?.(
        response.headers.get('x-ratelimit-remaining'),
        response.headers.get('x-ratelimit-limit'),
      );
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        if (attempt === 3) throw new UpstreamError(`HTTP_${response.status}`);
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
        const wait =
          retryAfter === null
            ? 250 * 2 ** attempt + Math.random() * 150
            : Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(retryAfter) - Date.now();
        const boundedWait = Number.isFinite(wait) ? Math.max(0, wait) : 1000;
        if (Date.now() + boundedWait >= deadline) throw new UpstreamError('RETRY_LATER');
        await (this.options.sleep ?? delay)(boundedWait);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new UpstreamError(`HTTP_${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new UpstreamError('EMPTY_RESPONSE');
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 16 * 1024 * 1024) {
            await reader.cancel();
            throw new UpstreamError('RESPONSE_TOO_LARGE');
          }
          chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch (error) {
        if (error instanceof UpstreamError) throw error;
        throw new UpstreamError(signal.aborted ? 'REQUEST_TIMEOUT' : 'INVALID_JSON');
      } finally {
        reader.releaseLock();
      }
    }
    throw new UpstreamError('RETRIES_EXHAUSTED');
  }
  activities(start: string, end: string) {
    return this.get(
      `/athlete/${encodeURIComponent(this.options.athleteId)}/activities?${new URLSearchParams({ oldest: `${start}T00:00:00`, newest: `${end}T23:59:59` })}`,
    );
  }
  wellness(start: string, end: string) {
    return this.get(
      `/athlete/${encodeURIComponent(this.options.athleteId)}/wellness?${new URLSearchParams({ oldest: start, newest: end })}`,
    );
  }
  activity(id: string) {
    return this.get(`/activity/${encodeURIComponent(id)}?intervals=true`);
  }
}
