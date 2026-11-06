import { describe, expect, it } from "vitest";
import { CircuitBreaker, type BreakerConfig, type BreakerState } from "../src/breaker.js";

const cfg: BreakerConfig = { windowSec: 10, maxRequestsPerSession: 5, maxChannelOpensPerMin: 3, maxParallelSessions: 2, maxChangeAttemptsPerMin: 2, cooldownSec: 60 };
const V = "0xVault";

function mk() {
  let now = 1_000_000;
  const trips: BreakerState[] = [];
  const b = new CircuitBreaker(cfg, (s) => trips.push(s), () => now);
  return { b, trips, tick: (ms: number) => (now += ms) };
}

describe("circuit breaker (F2)", () => {
  it("velocity: too many paid requests from one session in the window trips", () => {
    const { b, trips } = mk();
    for (let i = 0; i < 5; i++) b.recordRequest(V, "0xS1");
    expect(b.isOpen(V)).toBe(false);
    b.recordRequest(V, "0xS1");
    expect(b.isOpen(V)).toBe(true);
    expect(trips).toHaveLength(1);
    expect(trips[0].reason).toBe("velocity");
  });

  it("velocity window slides: the same count spread over time does not trip", () => {
    const { b, tick } = mk();
    for (let i = 0; i < 20; i++) {
      b.recordRequest(V, "0xS1");
      tick(2_500); // ≤ 4 per 10 s window
    }
    expect(b.isOpen(V)).toBe(false);
  });

  it("fan-out: too many channel opens per minute trips", () => {
    const { b, trips } = mk();
    for (let i = 0; i < 3; i++) b.recordChannelOpen(V, "0xS1");
    expect(b.isOpen(V)).toBe(false);
    b.recordChannelOpen(V, "0xS1");
    expect(b.isOpen(V)).toBe(true);
    expect(trips[0].reason).toBe("fan_out");
  });

  it("parallel sessions: too many distinct sessions active in the window trips", () => {
    const { b, trips } = mk();
    b.recordRequest(V, "0xS1");
    b.recordRequest(V, "0xS2");
    expect(b.isOpen(V)).toBe(false);
    b.recordRequest(V, "0xS3");
    expect(b.isOpen(V)).toBe(true);
    expect(trips[0].reason).toBe("parallel_sessions");
    expect(trips[0].sessionsSeen.sort()).toEqual(["0xs1", "0xs2", "0xs3"]);
  });

  it("repeated mandate-change attempts trip", () => {
    const { b, trips } = mk();
    b.recordChangeAttempt(V);
    b.recordChangeAttempt(V);
    b.recordChangeAttempt(V);
    expect(trips[0].reason).toBe("change_attempts");
  });

  it("one trip event per incident; resets after cooldown; manual reset works", () => {
    const { b, trips, tick } = mk();
    for (let i = 0; i < 10; i++) b.recordRequest(V, "0xS1");
    expect(trips).toHaveLength(1);
    expect(b.status(V).state).toBe("open");
    tick(59_000);
    expect(b.isOpen(V)).toBe(true);
    tick(2_000);
    expect(b.isOpen(V)).toBe(false); // cooldown elapsed
    for (let i = 0; i < 10; i++) b.recordRequest(V, "0xS1");
    expect(b.isOpen(V)).toBe(true);
    b.reset(V);
    expect(b.isOpen(V)).toBe(false);
  });

  it("vaults are isolated", () => {
    const { b } = mk();
    for (let i = 0; i < 10; i++) b.recordRequest(V, "0xS1");
    expect(b.isOpen(V)).toBe(true);
    expect(b.isOpen("0xOther")).toBe(false);
  });
});
