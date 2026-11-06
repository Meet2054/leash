import { describe, expect, it } from "vitest";
import { callerLane, parseApiKeys } from "../src/app.js";
import { Store } from "../src/db.js";

describe("API-key lane", () => {
  const keys = parseApiKeys({ LEASH_API_KEYS: "arena:aaaaaaaaaaaaaaaaaaaaaaaa, short:x", ARENA_API_KEY: undefined });
  it("parses name:key pairs and ignores weak keys", () => {
    expect([...keys.values()]).toEqual(["arena"]);
    expect(parseApiKeys({ ARENA_API_KEY: "bbbbbbbbbbbbbbbbbbbb" }).get("bbbbbbbbbbbbbbbbbbbb")).toBe("arena");
  });
  it("valid key → its own lane; no key → per-IP lane; wrong key → rejected", () => {
    expect(callerLane("aaaaaaaaaaaaaaaaaaaaaaaa", keys, "1.2.3.4")).toEqual({ lane: "key:arena" });
    expect(callerLane(undefined, keys, "1.2.3.4")).toEqual({ lane: "ip:1.2.3.4" });
    expect(callerLane("nope", keys, "1.2.3.4")).toEqual({ error: "bad_api_key" });
  });
});

describe("GET /stats?vault= counters", () => {
  it("only counts this vault's channels, vouchers and claims", () => {
    const s = new Store();
    const V = "0x00000000000000000000000000000000000000aa";
    const W = "0x00000000000000000000000000000000000000bb";
    const ins = s.db.prepare("INSERT INTO channels (id, chain_id, vault, session, merchant, locked, expiry, opened_at, last_accepted, vouchers, claimed_onchain, status) VALUES (?, 1874, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)");
    ins.run("0xc1", V, "0xs1", "0xm1", "1000000", "30000", 3, "20000", "open");
    ins.run("0xc2", V, "0xs1", "0xm2", "1000000", "50000", 2, "0", "closed");
    ins.run("0xc3", W, "0xs9", "0xm1", "1000000", "999999", 99, "0", "open");
    const claim = s.db.prepare("INSERT INTO claims (tx, channel_id, chain_id, merchant, delta, cumulative, fee, vouchers_covered, calldata_bytes, gas_used, cost_wei, at) VALUES (?, ?, 1874, ?, ?, ?, ?, ?, 228, '1', '1', ?)");
    claim.run("0xt1", "0xc1", "0xm1", "20000", "20000", "1000", 2, 10);
    claim.run("0xt9", "0xc3", "0xm1", "500000", "500000", "1000", 50, 11);
    const st = s.vaultStats(V.toUpperCase().replace("0X", "0x"));
    expect(st.channels).toEqual({ total: 2, open: 1, lockedOpenAtomic: "1000000" });
    expect(st.vouchersServed).toBe(5);
    expect(st.committedByVouchersAtomic).toBe("80000");
    expect(st.claims.count).toBe(1);
    expect(st.claims.paidToMerchantsAtomic).toBe("19000");
    expect(st.bySession).toEqual([{ session: "0xs1", channels: 2, vouchers: 5, committedAtomic: "80000" }]);
  });
});
