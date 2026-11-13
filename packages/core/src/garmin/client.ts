import type { Logger } from 'pino';
import type { z } from 'zod';
import { logger } from '../config.ts';
import { GarminError, GarminRateLimitError } from './errors.ts';
import { GarminRequestGate } from './request-gate.ts';
import { garminResponses, validateGarminResponse } from './schemas.ts';

export { GarminError } from './errors.ts';

const HOST = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const MAX_BYTES = 16 * 1024 * 1024;

// Preserve integer IDs before JSON parsing can round them. Measurements still undergo validation.
export function parseGarminJson(text: string): unknown {
  try {
    return JSON.parse(text, (_key, value, context?: { source?: string }) => {
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        if (context?.source && /^\d+$/.test(context.source)) return context.source;
        throw new GarminError('UNSAFE_JSON_NUMBER');
      }
      return value;
    });
  } catch {
    throw new GarminError('INVALID_JSON');
  }
}

function numericHeader(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function retryAfterSeconds(value: string | null): number | null {
  if (value === null) return null;
  if (/^\d+$/.test(value)) return numericHeader(value);
  // Log a parsed delay, never an arbitrary upstream header value.
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

export class GarminClient {
  #key: string;
  #gate: GarminRequestGate;
  #logger: Logger;
  #token: string | undefined;
  #fetch: typeof fetch;
  #signal: AbortSignal;
  #onRequest: (() => Promise<void>) | undefined;
  requests = 0;
  rateLimits: { remaining: string | null; limit: string | null }[] = [];

  constructor(
    key: string,
    options: {
      fetch?: typeof fetch;
      signal?: AbortSignal;
      onRequest?: () => Promise<void>;
      logger?: Logger;
      gate?: GarminRequestGate;
      requestIntervalMs?: number;
    } = {},
  ) {
    if (!key.trim()) throw new GarminError('GARMIN_KEY_NOT_CONFIGURED');
    this.#key = key;
    this.#gate = options.gate ?? new GarminRequestGate({ intervalMs: options.requestIntervalMs });
    this.#logger = options.logger ?? logger;
    this.#fetch = options.fetch ?? fetch;
    this.#signal = AbortSignal.any([
      AbortSignal.timeout(10 * 60 * 1000),
      ...(options.signal ? [options.signal] : []),
    ]);
    this.#onRequest = options.onRequest;
  }

  async #request(path: string, endpoint: string, token = false): Promise<Uint8Array | null> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new GarminError('INVALID_PATH');
    this.#signal.throwIfAborted();
    if (this.requests >= 20000) throw new GarminError('REQUEST_LIMIT');
    await this.#gate.wait(this.#signal);
    await this.#onRequest?.();
    this.requests++;
    const signal = AbortSignal.any([this.#signal, AbortSignal.timeout(60000)]);
    const started = performance.now();
    // Endpoint labels exclude activity IDs, dates, query strings and authentication data.
    const context = { endpoint, method: token ? 'POST' : 'GET', request_number: this.requests };
    let status: number | undefined;
    let retryAfter: number | null = null;
    let bytes = 0;
    let completed = false;
    let rateLimit: number | null = null;
    let remaining: number | null = null;
    this.#logger.debug({ event: 'garmin_request_started', ...context }, 'Garmin request started');
    try {
      const response = await this.#fetch(`${HOST}${path}`, {
        method: token ? 'POST' : 'GET',
        headers: {
          Authorization: token ? `ApiKey ${this.#key}` : `Bearer ${this.#token}`,
          Accept: token ? 'text/plain, application/json' : '*/*',
        },
        redirect: 'error',
        signal,
      });
      status = response.status;
      retryAfter = retryAfterSeconds(response.headers.get('retry-after'));
      rateLimit = numericHeader(response.headers.get('x-ratelimit-limit'));
      remaining = numericHeader(response.headers.get('x-ratelimit-remaining'));
      this.rateLimits.push({
        remaining: response.headers.get('x-ratelimit-remaining'),
        limit: response.headers.get('x-ratelimit-limit'),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 429) {
          this.#gate.blockFor(retryAfter);
          throw new GarminRateLimitError(this.#gate.cooldownUntil);
        }
        throw new GarminError(`HTTP_${response.status}`);
      }
      if (response.status === 204 && !token) {
        completed = true;
        return null;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new GarminError('EMPTY_RESPONSE');
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) {
            await reader.cancel();
            throw new GarminError('RESPONSE_TOO_LARGE');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      completed = true;
      return Buffer.concat(chunks);
    } catch (error) {
      const failure =
        error instanceof GarminError
          ? error
          : new GarminError(signal.aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR');
      this.#logger.warn(
        {
          event: 'garmin_request_failed',
          ...context,
          code: failure.message,
          status,
          retry_after_s: retryAfter,
          rate_limit: rateLimit,
          rate_limit_remaining: remaining,
          duration_ms: Math.round(performance.now() - started),
        },
        status === 429
          ? 'Garmin rate limit reached; import stops without retrying'
          : 'Garmin request failed',
      );
      throw failure;
    } finally {
      if (completed) {
        this.#logger.debug(
          {
            event: 'garmin_response_received',
            ...context,
            status,
            bytes,
            duration_ms: Math.round(performance.now() - started),
          },
          'Garmin response received',
        );
      }
    }
  }

  async #authenticate() {
    if (this.#token) return;
    const bytes = await this.#request(TOKEN_PATH, 'token', true);
    const token = bytes ? Buffer.from(bytes).toString('utf8').trim() : '';
    // The Personal API returns a raw token, not an OAuth refresh-token response.
    this.#token = validateGarminResponse(garminResponses.token, token);
  }

  async json<T>(path: string, contract: { name: string; schema: z.ZodType<T> }): Promise<T> {
    await this.#authenticate();
    const bytes = await this.#request(path, contract.name);
    const input = bytes === null ? null : parseGarminJson(Buffer.from(bytes).toString('utf8'));
    return validateGarminResponse(contract, input);
  }

  async activityFile(id: string): Promise<Uint8Array> {
    if (!/^\d+$/.test(id)) throw new GarminError('INVALID_ACTIVITY_ID');
    await this.#authenticate();
    const bytes = await this.#request(`/download-service/files/activity/${id}`, 'activity_file');
    if (!bytes?.length) throw new GarminError('EMPTY_ACTIVITY_FILE');
    return bytes;
  }
}
