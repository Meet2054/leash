import { RelayerError } from "./errors.js";

/** Simple async mutex: run() calls execute one at a time, in order. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** Keyed mutex: serializes work per key (e.g. per payment channel). */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const settled = next.catch(() => undefined);
    this.tails.set(key, settled);
    void settled.then(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });
    return next;
  }
}

/** Daily op budgets per key (e.g. "vault:0x..:open", "merchant:0x..:claim"). Resets at UTC midnight. */
export class BudgetBook {
  private day = BudgetBook.today();
  private readonly used = new Map<string, number>();

  constructor(private readonly limits: (key: string) => number | undefined) {}

  static today() {
    return new Date().toISOString().slice(0, 10);
  }

  private roll() {
    const d = BudgetBook.today();
    if (d !== this.day) {
      this.day = d;
      this.used.clear();
    }
  }

  check(key: string) {
    this.roll();
    const limit = this.limits(key);
    if (limit !== undefined && (this.used.get(key) ?? 0) >= limit) {
      throw new RelayerError("budget_exceeded", `daily op budget for ${key} exhausted (${limit})`);
    }
  }

  consume(key: string) {
    this.check(key);
    this.used.set(key, (this.used.get(key) ?? 0) + 1);
  }

  usage(): Record<string, { used: number; limit?: number }> {
    this.roll();
    const out: Record<string, { used: number; limit?: number }> = {};
    for (const [k, v] of this.used) out[k] = { used: v, limit: this.limits(k) };
    return out;
  }
}

/** Token bucket rate limiter per key. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    const tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, at: now });
      return false;
    }
    this.buckets.set(key, { tokens: tokens - 1, at: now });
    return true;
  }

  enforce(key: string) {
    if (!this.take(key)) throw new RelayerError("rate_limited", `rate limit exceeded for ${key}`);
  }
}
