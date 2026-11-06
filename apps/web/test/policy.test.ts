import { describe, expect, it } from "vitest";
import { encode } from "@leash/sdk";
import { DEFAULT_POLICY, effectsOf, evaluate, recordsOf, type CurrentState } from "../lib/server/policy";

const S = "0x00000000000000000000000000000000000000a1" as const;
const M = "0x00000000000000000000000000000000000000b2" as const;
const TO = "0x00000000000000000000000000000000000000c3" as const;
const U = 1_000_000n;
const cur = (cap = 5n * U, m = { allowed: true, dailyCap: 10n * U, maxChannel: 1n * U }): CurrentState => ({
  sessionCap: (s) => (s.toLowerCase() === S ? cap : 0n),
  merchant: () => m,
});
const NOW = 1_800_000_000;

describe("F8.1 attestor loosening policy", () => {
  it("R1: a raise up to 2× the current limit is allowed, beyond is refused", () => {
    const ok = encode.setSessionLimits(S, 0n, 10n * U);
    expect(evaluate(effectsOf(ok.action, ok.data, cur()), [], NOW).ok).toBe(true);
    const tooMuch = encode.setSessionLimits(S, 0n, 11n * U);
    const d = evaluate(effectsOf(tooMuch.action, tooMuch.data, cur()), [], NOW);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/^R1/);
  });

  it("R1: chained raises within 24 h are measured against the value 24 h ago (no 2×-then-2× ratchet)", () => {
    // earlier today: 5 → 10 approved; now the onchain cap is 10 and the agent asks for 20
    const history = recordsOf([{ kind: "session_cap", target: S, before: 5n * U, after: 10n * U }], NOW - 3600);
    const ask = encode.setSessionLimits(S, 0n, 20n * U);
    const d = evaluate(effectsOf(ask.action, ask.data, cur(10n * U)), history, NOW);
    expect(d.ok).toBe(false);
    // a day later the window has moved on, so 10 → 20 is fine
    expect(evaluate(effectsOf(ask.action, ask.data, cur(10n * U)), history, NOW + 86_401).ok).toBe(true);
  });

  it("R1: merchant daily cap and max channel follow the same 2× rule", () => {
    const ask = encode.setMerchant(M, 25n * U, 1n * U);
    const d = evaluate(effectsOf(ask.action, ask.data, cur()), [], NOW);
    expect(d.ok).toBe(false);
  });

  it("R2: daily ceiling on new spend authority (new sessions + raises + withdrawals)", () => {
    const cfg = { ...DEFAULT_POLICY, dailyCeiling: 20n * U };
    const history = recordsOf([{ kind: "session_cap", target: "0xother", before: 0n, after: 15n * U }], NOW - 600);
    const ask = encode.addSession(S, 0n, 6n * U); // 15 used + 6 asked > 20
    const d = evaluate(effectsOf(ask.action, ask.data, cur(0n)), history, NOW, cfg);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/^R2/);
    const small = encode.addSession(S, 0n, 5n * U); // 15 + 5 = 20 ≤ 20
    expect(evaluate(effectsOf(small.action, small.data, cur(0n)), history, NOW, cfg).ok).toBe(true);
  });

  it("R3: withdrawals above the threshold get a cooldown; small ones don't", () => {
    const big = encode.withdraw(TO, 6n * U);
    const d = evaluate(effectsOf(big.action, big.data, cur()), [], NOW);
    expect(d.ok && d.cooldownSec).toBe(DEFAULT_POLICY.cooldownSec);
    const small = encode.withdraw(TO, 5n * U);
    const d2 = evaluate(effectsOf(small.action, small.data, cur()), [], NOW);
    expect(d2.ok && d2.cooldownSec).toBe(0);
  });

  it("BATCH effects are evaluated together (no splitting a big loosening into small ops)", () => {
    const cfg = { ...DEFAULT_POLICY, dailyCeiling: 10n * U };
    const b = encode.batch([encode.addSession(S, 0n, 6n * U), encode.withdraw(TO, 5n * U)]);
    const d = evaluate(effectsOf(b.action, b.data, cur(0n)), [], NOW, cfg);
    expect(d.ok).toBe(false);
  });

  it("tightening produces no loosening effects", () => {
    const lower = encode.setSessionLimits(S, 0n, 1n * U);
    expect(effectsOf(lower.action, lower.data, cur())).toEqual([]);
    const rev = encode.revokeSession(S);
    expect(effectsOf(rev.action, rev.data, cur())).toEqual([]);
  });
});
