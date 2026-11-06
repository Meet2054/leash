/**
 * Circuit breaker (feature F2). Tightening is safe to automate: when a vault's agents behave like a swarm
 * (payment velocity, channel fan-out, many parallel sessions, repeated mandate-change attempts), stop all
 * spending from that vault at once and ask the owner to freeze it. Owner actions are never blocked —
 * anything may tighten; only loosening needs a human.
 */
export type BreakerConfig = {
  windowSec: number; // sliding window for velocity / parallel sessions
  maxRequestsPerSession: number; // paid-request attempts per session per window
  maxChannelOpensPerMin: number; // new channels per vault per minute
  maxParallelSessions: number; // distinct sessions of one vault active per window
  maxChangeAttemptsPerMin: number; // mandate-change relays per vault per minute
  cooldownSec: number; // breaker stays open this long (then half-closes automatically)
};

export const DEFAULT_BREAKER: BreakerConfig = {
  windowSec: 10,
  maxRequestsPerSession: 150, // normal demo agent peaks at ~106 per 10 s
  maxChannelOpensPerMin: 8,
  maxParallelSessions: 4,
  maxChangeAttemptsPerMin: 6,
  cooldownSec: 300,
};

export type TripReason = "velocity" | "fan_out" | "parallel_sessions" | "change_attempts";
export type BreakerState = {
  vault: string;
  state: "closed" | "open";
  reason?: TripReason;
  detail?: string;
  trippedAt?: number;
  reopensAt?: number;
  sessionsSeen: string[];
  metrics: { requestsInWindow: number; channelOpensLastMin: number; parallelSessions: number; changeAttemptsLastMin: number };
};

type VaultTrack = {
  requests: { t: number; session: string }[];
  opens: number[];
  changes: number[];
  open?: { reason: TripReason; detail: string; at: number; until: number; sessions: string[] };
};

export class CircuitBreaker {
  private readonly vaults = new Map<string, VaultTrack>();

  constructor(
    readonly cfg: BreakerConfig = DEFAULT_BREAKER,
    private readonly onTrip: (s: BreakerState) => void = () => undefined,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private track(vault: string): VaultTrack {
    const k = vault.toLowerCase();
    let v = this.vaults.get(k);
    if (!v) this.vaults.set(k, (v = { requests: [], opens: [], changes: [] }));
    return v;
  }

  private prune(v: VaultTrack, now: number) {
    const w = now - this.cfg.windowSec * 1000;
    const m = now - 60_000;
    v.requests = v.requests.filter((r) => r.t > w);
    v.opens = v.opens.filter((t) => t > m);
    v.changes = v.changes.filter((t) => t > m);
    if (v.open && now >= v.open.until) v.open = undefined; // cooldown elapsed
  }

  /** Is spending from this vault allowed right now? */
  isOpen(vault: string): boolean {
    const v = this.track(vault);
    this.prune(v, this.clock());
    return Boolean(v.open);
  }

  recordRequest(vault: string, session: string) {
    const now = this.clock();
    const v = this.track(vault);
    this.prune(v, now);
    v.requests.push({ t: now, session: session.toLowerCase() });
    const mine = v.requests.filter((r) => r.session === session.toLowerCase()).length;
    const sessions = new Set(v.requests.map((r) => r.session));
    if (mine > this.cfg.maxRequestsPerSession) this.trip(vault, "velocity", `${mine} paid requests from one session in ${this.cfg.windowSec}s (limit ${this.cfg.maxRequestsPerSession})`);
    else if (sessions.size > this.cfg.maxParallelSessions) this.trip(vault, "parallel_sessions", `${sessions.size} sessions active in ${this.cfg.windowSec}s (limit ${this.cfg.maxParallelSessions})`);
  }

  recordChannelOpen(vault: string, session: string) {
    const now = this.clock();
    const v = this.track(vault);
    this.prune(v, now);
    v.opens.push(now);
    v.requests.push({ t: now, session: session.toLowerCase() });
    if (v.opens.length > this.cfg.maxChannelOpensPerMin) this.trip(vault, "fan_out", `${v.opens.length} channel opens in 60s (limit ${this.cfg.maxChannelOpensPerMin})`);
  }

  recordChangeAttempt(vault: string) {
    const now = this.clock();
    const v = this.track(vault);
    this.prune(v, now);
    v.changes.push(now);
    if (v.changes.length > this.cfg.maxChangeAttemptsPerMin) this.trip(vault, "change_attempts", `${v.changes.length} mandate-change attempts in 60s (limit ${this.cfg.maxChangeAttemptsPerMin})`);
  }

  /** Manual reset (admin). Cooldown expiry also resets automatically. */
  reset(vault: string) {
    const v = this.track(vault);
    v.open = undefined;
    v.requests = [];
    v.opens = [];
    v.changes = [];
  }

  status(vault: string): BreakerState {
    const now = this.clock();
    const v = this.track(vault);
    this.prune(v, now);
    return {
      vault,
      state: v.open ? "open" : "closed",
      reason: v.open?.reason,
      detail: v.open?.detail,
      trippedAt: v.open?.at,
      reopensAt: v.open?.until,
      sessionsSeen: v.open?.sessions ?? [...new Set(v.requests.map((r) => r.session))],
      metrics: {
        requestsInWindow: v.requests.length,
        channelOpensLastMin: v.opens.length,
        parallelSessions: new Set(v.requests.map((r) => r.session)).size,
        changeAttemptsLastMin: v.changes.length,
      },
    };
  }

  private trip(vault: string, reason: TripReason, detail: string) {
    const v = this.track(vault);
    if (v.open) return; // already open: one trip event per incident
    const now = this.clock();
    v.open = { reason, detail, at: now, until: now + this.cfg.cooldownSec * 1000, sessions: [...new Set(v.requests.map((r) => r.session))] };
    this.onTrip(this.status(vault));
  }
}

export function breakerConfigFromEnv(env: Record<string, string | undefined> = process.env): BreakerConfig {
  const n = (k: string, d: number) => (env[k] ? Number(env[k]) : d);
  return {
    windowSec: n("BREAKER_WINDOW_SEC", DEFAULT_BREAKER.windowSec),
    maxRequestsPerSession: n("BREAKER_MAX_REQUESTS_PER_SESSION", DEFAULT_BREAKER.maxRequestsPerSession),
    maxChannelOpensPerMin: n("BREAKER_MAX_CHANNEL_OPENS_PER_MIN", DEFAULT_BREAKER.maxChannelOpensPerMin),
    maxParallelSessions: n("BREAKER_MAX_PARALLEL_SESSIONS", DEFAULT_BREAKER.maxParallelSessions),
    maxChangeAttemptsPerMin: n("BREAKER_MAX_CHANGE_ATTEMPTS_PER_MIN", DEFAULT_BREAKER.maxChangeAttemptsPerMin),
    cooldownSec: n("BREAKER_COOLDOWN_SEC", DEFAULT_BREAKER.cooldownSec),
  };
}
