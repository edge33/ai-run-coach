import { setTimeout as delay } from 'node:timers/promises';
import { GarminRateLimitError } from './errors.ts';

/** Shared by imports in one API instance; never initiates requests or retries. */
export class GarminRequestGate {
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  #nextRequestAt = 0;
  #blockedUntil = 0;

  constructor(
    options: {
      intervalMs?: number;
      now?: () => number;
      sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    } = {},
  ) {
    this.#intervalMs = options.intervalMs ?? 1000;
    if (!Number.isInteger(this.#intervalMs) || this.#intervalMs < 0 || this.#intervalMs > 60000) {
      throw new Error('INVALID_GARMIN_REQUEST_INTERVAL_MS');
    }
    this.#now = options.now ?? Date.now;
    this.#sleep =
      options.sleep ?? ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
  }

  get cooldownUntil(): string | null {
    return this.#blockedUntil > this.#now() ? new Date(this.#blockedUntil).toISOString() : null;
  }

  assertAvailable() {
    if (this.cooldownUntil) throw new GarminRateLimitError(this.cooldownUntil);
  }

  blockFor(seconds: number | null) {
    if (seconds === null) return;
    const until = this.#now() + seconds * 1000;
    if (Number.isFinite(until) && until <= 8640000000000000) {
      this.#blockedUntil = Math.max(this.#blockedUntil, until);
    }
  }

  async wait(signal: AbortSignal) {
    signal.throwIfAborted();
    this.assertAvailable();
    const remaining = this.#nextRequestAt - this.#now();
    if (remaining > 0) await this.#sleep(remaining, signal);
    signal.throwIfAborted();
    this.assertAvailable();
    this.#nextRequestAt = this.#now() + this.#intervalMs;
  }
}
