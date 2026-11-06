/**
 * F8.1 — attestor loosening policy (Bybit/Binance hardening). Pure functions; the attestor applies them
 * before starting a World check and again before signing a WorldApproval.
 *   R1  a raised limit may be at most 2× its value 24 h ago (per target: session cap, merchant limits)
 *   R2  daily ceiling on new spend authority per vault (Δ session caps + new sessions + withdrawals)
 *   R3  withdrawals above a threshold need a cooldown (default 15 min) after the World check, before the
 *       attestor signs; any mandate change during the cooldown (e.g. a PQ-signed tightening) cancels it
 *       because the pending change's nonce is then stale.
 */
import { decodeAbiParameters, type Hex } from "viem";

export type PolicyConfig = {
  maxRaiseFactor: number; // R1
  dailyCeiling: bigint; // R2, atomic USDT per 24 h
  withdrawCooldownAbove: bigint; // R3 threshold, atomic USDT
  cooldownSec: number; // R3
};

export const DEFAULT_POLICY: PolicyConfig = {
  maxRaiseFactor: 2,
  dailyCeiling: 100_000_000n, // 100 USDT
  withdrawCooldownAbove: 5_000_000n, // 5 USDT
  cooldownSec: 15 * 60,
};

export function policyFromEnv(env: Record<string, string | undefined> = process.env): PolicyConfig {
  return {
    maxRaiseFactor: env.POLICY_MAX_RAISE_FACTOR ? Number(env.POLICY_MAX_RAISE_FACTOR) : DEFAULT_POLICY.maxRaiseFactor,
    dailyCeiling: env.POLICY_DAILY_CEILING ? BigInt(env.POLICY_DAILY_CEILING) : DEFAULT_POLICY.dailyCeiling,
    withdrawCooldownAbove: env.POLICY_WITHDRAW_COOLDOWN_ABOVE ? BigInt(env.POLICY_WITHDRAW_COOLDOWN_ABOVE) : DEFAULT_POLICY.withdrawCooldownAbove,
    // WorldApproval.authTime must be < 1 h old onchain (MAX_AUTH_AGE), so the cooldown is capped at 45 min
    cooldownSec: Math.min(env.POLICY_COOLDOWN_SEC ? Number(env.POLICY_COOLDOWN_SEC) : DEFAULT_POLICY.cooldownSec, MAX_COOLDOWN_SEC),
  };
}
export const MAX_COOLDOWN_SEC = 45 * 60;

/** One loosening, decoded into comparable effects. */
export type Effect =
  | { kind: "session_cap"; target: string; before: bigint; after: bigint } // raise or new session (before = 0)
  | { kind: "merchant_daily"; target: string; before: bigint; after: bigint }
  | { kind: "merchant_max"; target: string; before: bigint; after: bigint }
  | { kind: "withdraw"; target: string; amount: bigint }
  | { kind: "root_change"; target: string }; // ROTATE_PQ_KEY / SET_VERIFIER

/** Onchain values the decoder needs (current state). */
export type CurrentState = {
  sessionCap: (session: string) => bigint; // 0 if unknown
  merchant: (merchant: string) => { allowed: boolean; dailyCap: bigint; maxChannel: bigint };
};

const SESSION = [{ type: "address" }, { type: "uint64" }, { type: "uint128" }] as const;
const MERCHANT = [{ type: "address" }, { type: "uint128" }, { type: "uint128" }] as const;
const OPS = [{ type: "tuple[]", components: [{ name: "action", type: "uint8" }, { name: "data", type: "bytes" }] }] as const;

/** Decode a mandate change (action + data) into loosening effects, against the current onchain state. */
export function effectsOf(action: number, data: Hex, cur: CurrentState): Effect[] {
  switch (action) {
    case 0: {
      const [s, , cap] = decodeAbiParameters(SESSION, data);
      return [{ kind: "session_cap", target: s.toLowerCase(), before: 0n, after: cap }];
    }
    case 1: {
      const [s, , cap] = decodeAbiParameters(SESSION, data);
      const before = cur.sessionCap(s);
      return cap > before ? [{ kind: "session_cap", target: s.toLowerCase(), before, after: cap }] : [];
    }
    case 3: {
      const [m, daily, max] = decodeAbiParameters(MERCHANT, data);
      const c = cur.merchant(m);
      const out: Effect[] = [];
      const bd = c.allowed ? c.dailyCap : 0n;
      const bm = c.allowed ? c.maxChannel : 0n;
      if (daily > bd) out.push({ kind: "merchant_daily", target: m.toLowerCase(), before: bd, after: daily });
      if (max > bm) out.push({ kind: "merchant_max", target: m.toLowerCase(), before: bm, after: max });
      return out;
    }
    case 5: {
      const [to, amount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], data);
      return [{ kind: "withdraw", target: to.toLowerCase(), amount }];
    }
    case 6:
    case 7:
      return [{ kind: "root_change", target: String(action) }];
    case 8: {
      const [ops] = decodeAbiParameters(OPS, data);
      return ops.flatMap((o) => effectsOf(o.action, o.data, cur));
    }
    default:
      return [];
  }
}

/** A loosening the attestor already approved (kept 24 h for R1/R2). */
export type LooseningRecord = { at: number; kind: Effect["kind"]; target: string; before?: bigint; after?: bigint; amount?: bigint };

export type PolicyDecision =
  | { ok: true; cooldownSec: number; reasons: string[] }
  | { ok: false; reason: string };

const authorityOf = (e: Effect): bigint =>
  e.kind === "session_cap" ? e.after - e.before : e.kind === "withdraw" ? e.amount : 0n;

/** Evaluate a loosening against R1–R3 given the vault's approvals in the last 24 h. */
export function evaluate(effects: Effect[], history: LooseningRecord[], nowSec: number, cfg: PolicyConfig = DEFAULT_POLICY): PolicyDecision {
  const day = history.filter((h) => h.at > nowSec - 86_400);
  // R1: per target, the new value may be at most maxRaiseFactor × the value at the start of the 24 h window
  for (const e of effects) {
    if (e.kind !== "session_cap" && e.kind !== "merchant_daily" && e.kind !== "merchant_max") continue;
    const prior = day.filter((h) => h.kind === e.kind && h.target === e.target).sort((a, b) => a.at - b.at)[0];
    const baseline = prior?.before ?? e.before;
    if (baseline === 0n) continue; // a brand-new session/merchant is bounded by R2 (and merchant caps by session caps)
    const limit = BigInt(Math.floor(Number(baseline) * cfg.maxRaiseFactor));
    if (e.after > limit) {
      return { ok: false, reason: `R1: ${e.kind} for ${e.target.slice(0, 10)}… may at most ${cfg.maxRaiseFactor}× its value 24 h ago (${baseline} → max ${limit}, asked ${e.after})` };
    }
  }
  // R2: daily ceiling on new spend authority
  const used = day.reduce((a, h) => a + (h.kind === "session_cap" ? (h.after ?? 0n) - (h.before ?? 0n) : h.kind === "withdraw" ? h.amount ?? 0n : 0n), 0n);
  const asked = effects.reduce((a, e) => a + authorityOf(e), 0n);
  if (used + asked > cfg.dailyCeiling) {
    return { ok: false, reason: `R2: daily loosening ceiling ${cfg.dailyCeiling} exceeded (used ${used} in 24 h + asked ${asked})` };
  }
  // R3: large withdrawals wait out a cooldown before the attestor signs
  const big = effects.find((e) => e.kind === "withdraw" && e.amount > cfg.withdrawCooldownAbove);
  const reasons: string[] = [];
  if (big) reasons.push(`R3: withdrawal above ${cfg.withdrawCooldownAbove} → ${cfg.cooldownSec}s cooldown, cancellable by any PQ-signed change`);
  return { ok: true, cooldownSec: big ? cfg.cooldownSec : 0, reasons };
}

/** History records to store once a loosening is approved. */
export function recordsOf(effects: Effect[], at: number): LooseningRecord[] {
  return effects.map((e) =>
    e.kind === "withdraw"
      ? { at, kind: e.kind, target: e.target, amount: e.amount }
      : e.kind === "root_change"
        ? { at, kind: e.kind, target: e.target }
        : { at, kind: e.kind, target: e.target, before: e.before, after: e.after },
  );
}
