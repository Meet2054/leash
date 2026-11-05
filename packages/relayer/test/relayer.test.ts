import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineChain, parseEther, type Address, type Hex } from "viem";
import { Relayer, RelayerError, RateLimiter, KeyedMutex, BudgetBook } from "../src/index.js";
import { ANVIL_KEYS, rpc, startAnvil, type Anvil } from "../src/testing.js";

const anvilChain = (url: string) =>
  defineChain({
    id: 31337,
    name: "anvil",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });

const EOA_TARGET: Address = "0x00000000000000000000000000000000000000A1";
const REVERTER: Address = "0x00000000000000000000000000000000000000B2";
const allowAll = () => true;

let anvil: Anvil;
beforeAll(async () => {
  anvil = await startAnvil();
  await rpc(anvil.url, "anvil_setCode", [REVERTER, "0x60006000fd"]); // PUSH0 PUSH0 REVERT
});
afterAll(() => anvil?.stop());

const mk = (over: Partial<ConstructorParameters<typeof Relayer>[0]> = {}, key: Hex = ANVIL_KEYS[0]) =>
  new Relayer({
    chain: anvilChain(anvil.url),
    rpcUrl: anvil.url,
    privateKey: key,
    allow: allowAll,
    gasFloorGwei: "1",
    pollingIntervalMs: 50,
    ...over,
  });

describe("Relayer against anvil", () => {
  it("20 parallel sends get unique, consecutive nonces and all mine", async () => {
    const r = mk();
    const start = await r.publicClient.getTransactionCount({ address: r.address });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => r.send({ to: EOA_TARGET, data: `0x1234567${(i % 10).toString()}` as Hex, label: "ping" })),
    );
    const txs = await Promise.all(results.map((x) => r.publicClient.getTransaction({ hash: x.hash })));
    const nonces = txs.map((t) => t.nonce).sort((a, b) => a - b);
    expect(nonces).toEqual(Array.from({ length: 20 }, (_, i) => start + i));
    expect(results.every((x) => x.receipt.status === "success")).toBe(true);
    const tank = await r.gasTank();
    expect(tank.opsToday).toBe(20);
    expect(tank.opsByLabel.ping.count).toBe(20);
  });

  it("refuses a tx whose simulation reverts, and sends nothing", async () => {
    const r = mk({}, ANVIL_KEYS[1]);
    const before = await r.publicClient.getTransactionCount({ address: r.address });
    await expect(r.send({ to: REVERTER, data: "0xdeadbeef", label: "bad" })).rejects.toMatchObject({ code: "simulation_reverted" });
    expect(await r.publicClient.getTransactionCount({ address: r.address })).toBe(before);
  });

  it("budget exhaustion -> budget_exceeded (HTTP 429), counted only for valid ops", async () => {
    const r = mk({ budgetLimit: (k) => (k === "vault:x:open" ? 2 : undefined) }, ANVIL_KEYS[2]);
    // a reverting op must not burn budget
    await expect(r.send({ to: REVERTER, data: "0x01", label: "open", budgetKeys: ["vault:x:open"] })).rejects.toBeInstanceOf(RelayerError);
    await r.send({ to: EOA_TARGET, data: "0x01", label: "open", budgetKeys: ["vault:x:open"] });
    await r.send({ to: EOA_TARGET, data: "0x02", label: "open", budgetKeys: ["vault:x:open"] });
    const err = await r.send({ to: EOA_TARGET, data: "0x03", label: "open", budgetKeys: ["vault:x:open"] }).catch((e) => e);
    expect(err).toBeInstanceOf(RelayerError);
    expect(err.code).toBe("budget_exceeded");
    expect(err.status).toBe(429);
  });

  it("refuses calls that are not on the allowlist", async () => {
    const r = mk({ allow: (to) => to === EOA_TARGET });
    await expect(r.send({ to: REVERTER, data: "0x01", label: "x" })).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("auto-pauses when the gas tank is below the minimum", async () => {
    const r = mk({ minBalanceWei: parseEther("1000000") });
    await expect(r.send({ to: EOA_TARGET, data: "0x01", label: "x" })).rejects.toMatchObject({ code: "paused" });
    const tank = await r.gasTank();
    expect(tank.paused).toBe(true);
    expect(tank.pauseReason).toMatch(/below minimum/);
  });

  it("manual pause blocks sends until resumed", async () => {
    const r = mk();
    r.pause("maintenance");
    await expect(r.send({ to: EOA_TARGET, data: "0x01", label: "x" })).rejects.toMatchObject({ code: "paused" });
    r.resume();
    await expect(r.send({ to: EOA_TARGET, data: "0x01", label: "x" })).resolves.toBeTruthy();
  });

  it("replaces a stuck transaction with higher fees", async () => {
    const stuck = await startAnvil(["--no-mining"]);
    try {
      const r = new Relayer({
        chain: anvilChain(stuck.url),
        rpcUrl: stuck.url,
        privateKey: ANVIL_KEYS[3],
        allow: allowAll,
        gasFloorGwei: "1",
        pollingIntervalMs: 50,
        replaceAfterMs: 300,
        receiptTimeoutMs: 10_000,
      });
      setTimeout(() => void rpc(stuck.url, "evm_mine"), 1200);
      const res = await r.send({ to: EOA_TARGET, data: "0x01", label: "x", gas: 50_000n });
      expect(res.replaced).toBeGreaterThanOrEqual(1);
      expect(res.receipt.status).toBe("success");
    } finally {
      stuck.stop();
    }
  });
});

describe("limits", () => {
  it("RateLimiter: token bucket", () => {
    const rl = new RateLimiter(3, 1);
    const t = 1_000_000;
    expect([rl.take("a", t), rl.take("a", t), rl.take("a", t), rl.take("a", t)]).toEqual([true, true, true, false]);
    expect(rl.take("b", t)).toBe(true); // independent keys
    expect(rl.take("a", t + 1000)).toBe(true); // refilled one token
    expect(() => {
      rl.enforce("a");
      rl.enforce("a");
      rl.enforce("a");
      rl.enforce("a");
    }).toThrow(/rate_limited/);
  });

  it("KeyedMutex serializes per key and keeps order", async () => {
    const m = new KeyedMutex();
    const seen: number[] = [];
    await Promise.all(
      [30, 10, 0].map((delay, i) =>
        m.run("ch", async () => {
          await new Promise((r) => setTimeout(r, delay));
          seen.push(i);
        }),
      ),
    );
    expect(seen).toEqual([0, 1, 2]);
  });

  it("BudgetBook: check without consume does not count", () => {
    const b = new BudgetBook(() => 1);
    b.check("k");
    b.consume("k");
    expect(() => b.check("k")).toThrow(/budget_exceeded/);
  });
});
