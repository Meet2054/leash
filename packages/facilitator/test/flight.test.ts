import { describe, expect, it } from "vitest";
import { keccak256, type Hex } from "viem";
import { Store } from "../src/db.js";
import { leafOf, merkleRoot, resourceHash, verifyFlightRecords, type FlightRecord } from "../src/flight.js";

const CH = "0x" + "11".repeat(32);

function seed(store: Store, n: number) {
  for (let i = 1; i <= n; i++) store.logVoucher(CH, keccak256(`0x${i.toString(16).padStart(2, "0")}`), resourceHash(`https://m.example/quote?i=${i}`), String(i * 10_000), 1_800_000_000 + i);
}

function record(store: Store): FlightRecord {
  const rows = store.unrecordedVouchers(CH);
  const rec = { channelId: CH, claimTx: "0xclaim", merkleRoot: merkleRoot(rows.map(leafOf)), count: rows.length, firstId: rows[0].id, lastId: rows[rows.length - 1].id };
  store.insertFlightRecord(rec);
  return rec;
}

describe("agent flight recorder (F4)", () => {
  it("merkle root: deterministic, order-sensitive, odd leaf carried up", () => {
    const a = keccak256("0x01");
    const b = keccak256("0x02");
    const c = keccak256("0x03");
    expect(merkleRoot([a])).toBe(a);
    expect(merkleRoot([a, b])).toBe(keccak256(`0x${a.slice(2)}${b.slice(2)}` as Hex));
    expect(merkleRoot([a, b, c])).toBe(keccak256(`0x${merkleRoot([a, b]).slice(2)}${c.slice(2)}` as Hex));
    expect(merkleRoot([b, a])).not.toBe(merkleRoot([a, b]));
  });

  it("an untouched log verifies against the published root", () => {
    const s = new Store();
    seed(s, 7);
    const rec = record(s);
    const [res] = verifyFlightRecords(s.voucherLog(CH), [rec]);
    expect(res.ok).toBe(true);
    expect(res.rows).toBe(7);
  });

  it("tampering with one stored row breaks verification", () => {
    const s = new Store();
    seed(s, 7);
    const rec = record(s);
    s.db.prepare("UPDATE voucher_log SET cumulative = '999999' WHERE id = 4").run();
    expect(verifyFlightRecords(s.voucherLog(CH), [rec])[0].ok).toBe(false);
  });

  it("deleting a row breaks verification", () => {
    const s = new Store();
    seed(s, 5);
    const rec = record(s);
    s.db.prepare("DELETE FROM voucher_log WHERE id = 2").run();
    const [res] = verifyFlightRecords(s.voucherLog(CH), [rec]);
    expect(res.ok).toBe(false);
    expect(res.rows).toBe(4);
  });

  it("records cover only payments since the previous claim", () => {
    const s = new Store();
    seed(s, 3);
    const first = record(s);
    seed(s, 2);
    const second = record(s);
    expect([first.firstId, first.lastId, second.firstId, second.lastId]).toEqual([1, 3, 4, 5]);
    expect(verifyFlightRecords(s.voucherLog(CH), [first, second]).every((r) => r.ok)).toBe(true);
  });
});
