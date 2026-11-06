/**
 * pnpm verify-log [channelId]
 * Recompute every flight-record Merkle root from the facilitator's SQLite voucher log and compare it with the
 * roots published to the HCS audit topic (read from the public Hedera mirror node). Exit 1 on any mismatch.
 */
import { fileURLToPath } from "node:url";
import { Store } from "./db.js";
import { verifyFlightRecords, type FlightRecord } from "./flight.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const topic = process.env.HCS_TOPIC_ID;
if (!topic || topic.includes("placeholder")) throw new Error("HCS_TOPIC_ID not set");
const channelFilter = process.argv[2]?.toLowerCase();
const store = new Store(process.env.FACILITATOR_DB ?? `${root}data/facilitator-${process.env.CHAIN_ID ?? "1874"}.sqlite`);

async function hcsFlightRecords(): Promise<FlightRecord[]> {
  const out: FlightRecord[] = [];
  let next: string | null = `/api/v1/topics/${topic}/messages?limit=100&order=asc`;
  while (next) {
    const r = await fetch(`https://testnet.mirrornode.hedera.com${next}`);
    const j = (await r.json()) as { messages: { message: string; sequence_number: number }[]; links?: { next: string | null } };
    for (const m of j.messages ?? []) {
      try {
        const e = JSON.parse(Buffer.from(m.message, "base64").toString("utf8"));
        if (e.event === "FlightRecord") out.push({ channelId: e.channelId, claimTx: e.txHash, merkleRoot: e.merkleRoot, count: e.count, firstId: e.firstId, lastId: e.lastId });
      } catch {
        /* not JSON */
      }
    }
    next = j.links?.next ?? null;
  }
  return out;
}

const published = (await hcsFlightRecords()).filter((r) => !channelFilter || r.channelId.toLowerCase() === channelFilter);
const local = store.flightRecords(channelFilter);
const results = verifyFlightRecords(store.voucherLog(channelFilter), published);
let bad = 0;
for (const r of results) {
  if (!r.ok) bad++;
  console.log(`${r.ok ? "✓" : "✘"} channel ${r.channelId.slice(0, 10)}… claim ${r.claimTx.slice(0, 12)}… rows ${r.firstId}–${r.lastId} (${r.rows}/${r.count})  HCS root ${r.merkleRoot.slice(0, 14)}…  recomputed ${r.recomputed.slice(0, 14)}…`);
}
const onHcs = new Set(published.map((p) => p.claimTx.toLowerCase()));
for (const l of local) if (!onHcs.has(l.claim_tx.toLowerCase())) console.log(`… claim ${l.claim_tx.slice(0, 12)}… recorded locally, not yet visible on HCS`);
console.log(`${results.length - bad}/${results.length} flight records match HCS (topic ${topic}: https://hashscan.io/testnet/topic/${topic})`);
process.exit(bad ? 1 : 0);
