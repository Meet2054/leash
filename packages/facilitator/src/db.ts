import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type ChannelRow = {
  id: string;
  chain_id: number;
  vault: string;
  session: string;
  merchant: string;
  locked: string;
  expiry: number;
  open_tx: string | null;
  opened_at: number;
  last_accepted: string;
  last_sig: string | null;
  vouchers: number;
  vouchers_at_last_claim: number;
  claimed_onchain: string;
  last_claim_at: number | null;
  status: "open" | "closed";
};

export type ClaimRow = {
  tx: string;
  channel_id: string;
  chain_id: number;
  merchant: string;
  delta: string;
  cumulative: string;
  fee: string;
  vouchers_covered: number;
  calldata_bytes: number;
  gas_used: string;
  cost_wei: string;
  at: number;
};

export type EventRow = {
  id: number;
  at: number;
  kind: string;
  chain_id: number;
  vault: string | null;
  channel_id: string | null;
  amount: string | null;
  tx: string | null;
  data: string | null;
  hcs: string | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, vault TEXT NOT NULL, session TEXT NOT NULL, merchant TEXT NOT NULL,
  locked TEXT NOT NULL, expiry INTEGER NOT NULL, open_tx TEXT, opened_at INTEGER NOT NULL,
  last_accepted TEXT NOT NULL DEFAULT '0', last_sig TEXT, vouchers INTEGER NOT NULL DEFAULT 0,
  vouchers_at_last_claim INTEGER NOT NULL DEFAULT 0, claimed_onchain TEXT NOT NULL DEFAULT '0',
  last_claim_at INTEGER, status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS channels_lookup ON channels (vault, session, merchant, status);
CREATE TABLE IF NOT EXISTS claims (
  tx TEXT PRIMARY KEY, channel_id TEXT NOT NULL, chain_id INTEGER NOT NULL, merchant TEXT NOT NULL, delta TEXT NOT NULL,
  cumulative TEXT NOT NULL, fee TEXT NOT NULL, vouchers_covered INTEGER NOT NULL, calldata_bytes INTEGER NOT NULL,
  gas_used TEXT NOT NULL, cost_wei TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, chain_id INTEGER NOT NULL,
  vault TEXT, channel_id TEXT, amount TEXT, tx TEXT, data TEXT, hcs TEXT
);
CREATE TABLE IF NOT EXISTS resources (
  url TEXT PRIMARY KEY, method TEXT NOT NULL, merchant TEXT NOT NULL, description TEXT, accepts TEXT NOT NULL,
  extensions TEXT, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS voucher_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL, request_id TEXT NOT NULL, resource_hash TEXT NOT NULL,
  cumulative TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS voucher_log_channel ON voucher_log (channel_id, id);
CREATE TABLE IF NOT EXISTS flight_records (
  claim_tx TEXT PRIMARY KEY, channel_id TEXT NOT NULL, merkle_root TEXT NOT NULL, count INTEGER NOT NULL,
  first_id INTEGER NOT NULL, last_id INTEGER NOT NULL, at INTEGER NOT NULL
);
`;

/** SQLite store (node:sqlite, built into Node ≥ 22). All amounts are decimal strings (bigint-safe). */
export class Store {
  readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  insertChannel(c: Omit<ChannelRow, "last_accepted" | "last_sig" | "vouchers" | "vouchers_at_last_claim" | "claimed_onchain" | "last_claim_at" | "status">) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO channels (id, chain_id, vault, session, merchant, locked, expiry, open_tx, opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.id, c.chain_id, c.vault.toLowerCase(), c.session.toLowerCase(), c.merchant.toLowerCase(), c.locked, c.expiry, c.open_tx, c.opened_at);
  }

  channel(id: string): ChannelRow | undefined {
    return this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id.toLowerCase()) as ChannelRow | undefined;
  }

  channelsFor(vault: string, session?: string, merchant?: string): ChannelRow[] {
    let q = "SELECT * FROM channels WHERE vault = ?";
    const args: string[] = [vault.toLowerCase()];
    if (session) {
      q += " AND session = ?";
      args.push(session.toLowerCase());
    }
    if (merchant) {
      q += " AND merchant = ?";
      args.push(merchant.toLowerCase());
    }
    return this.db.prepare(q + " ORDER BY opened_at DESC").all(...args) as ChannelRow[];
  }

  allChannels(limit = 200): ChannelRow[] {
    return this.db.prepare("SELECT * FROM channels ORDER BY opened_at DESC LIMIT ?").all(limit) as ChannelRow[];
  }

  openChannelsWithUnclaimed(): ChannelRow[] {
    return (this.db.prepare("SELECT * FROM channels WHERE status = 'open'").all() as ChannelRow[]).filter(
      (c) => BigInt(c.last_accepted) > BigInt(c.claimed_onchain),
    );
  }

  openChannels(): ChannelRow[] {
    return this.db.prepare("SELECT * FROM channels WHERE status = 'open'").all() as ChannelRow[];
  }

  acceptVoucher(id: string, cumulative: string, sig: string) {
    this.db
      .prepare("UPDATE channels SET last_accepted = ?, last_sig = ?, vouchers = vouchers + 1 WHERE id = ?")
      .run(cumulative, sig, id.toLowerCase());
    this.bump("vouchers_served");
  }

  markClaimed(id: string, claimedOnchain: string, vouchersAtClaim: number, at: number, closed: boolean) {
    this.db
      .prepare(
        "UPDATE channels SET claimed_onchain = ?, vouchers_at_last_claim = ?, last_claim_at = ?, status = CASE WHEN ? THEN 'closed' ELSE status END WHERE id = ?",
      )
      .run(claimedOnchain, vouchersAtClaim, at, closed ? 1 : 0, id.toLowerCase());
  }

  setStatus(id: string, status: "open" | "closed") {
    this.db.prepare("UPDATE channels SET status = ? WHERE id = ?").run(status, id.toLowerCase());
  }

  insertClaim(c: ClaimRow) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO claims (tx, channel_id, chain_id, merchant, delta, cumulative, fee, vouchers_covered, calldata_bytes, gas_used, cost_wei, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.tx, c.channel_id, c.chain_id, c.merchant, c.delta, c.cumulative, c.fee, c.vouchers_covered, c.calldata_bytes, c.gas_used, c.cost_wei, c.at);
  }

  claims(limit = 100): ClaimRow[] {
    return this.db.prepare("SELECT * FROM claims ORDER BY at DESC LIMIT ?").all(limit) as ClaimRow[];
  }

  /** Claims submitted in the last `sinceSec` seconds (candidates for reorg reconciliation). */
  recentClaims(sinceSec: number): ClaimRow[] {
    return this.db.prepare("SELECT * FROM claims WHERE at >= ? ORDER BY at DESC").all(Math.floor(Date.now() / 1000) - sinceSec) as ClaimRow[];
  }

  /** A claim tx was rolled back: forget it and put the channel back to the onchain truth. */
  rollbackClaim(tx: string, channelId: string, onchainClaimed: string) {
    this.db.prepare("DELETE FROM claims WHERE tx = ?").run(tx);
    this.db.prepare("UPDATE channels SET claimed_onchain = ?, status = 'open' WHERE id = ?").run(onchainClaimed, channelId.toLowerCase());
  }

  claimTotals(): { count: number; calldataBytes: number; delta: bigint; fee: bigint; costWei: bigint } {
    const rows = this.db.prepare("SELECT delta, fee, calldata_bytes, cost_wei FROM claims").all() as Pick<ClaimRow, "delta" | "fee" | "calldata_bytes" | "cost_wei">[];
    return rows.reduce(
      (a, r) => ({
        count: a.count + 1,
        calldataBytes: a.calldataBytes + r.calldata_bytes,
        delta: a.delta + BigInt(r.delta),
        fee: a.fee + BigInt(r.fee),
        costWei: a.costWei + BigInt(r.cost_wei),
      }),
      { count: 0, calldataBytes: 0, delta: 0n, fee: 0n, costWei: 0n },
    );
  }

  insertEvent(e: Omit<EventRow, "id" | "hcs">): number {
    const r = this.db
      .prepare("INSERT INTO events (at, kind, chain_id, vault, channel_id, amount, tx, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(e.at, e.kind, e.chain_id, e.vault, e.channel_id, e.amount, e.tx, e.data);
    return Number(r.lastInsertRowid);
  }

  setEventHcs(id: number, hcs: string) {
    this.db.prepare("UPDATE events SET hcs = ? WHERE id = ?").run(hcs, id);
  }

  events(limit = 100, kind?: string): EventRow[] {
    if (kind) return this.db.prepare("SELECT * FROM events WHERE kind = ? ORDER BY id DESC LIMIT ?").all(kind, limit) as EventRow[];
    return this.db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit) as EventRow[];
  }

  upsertResource(r: { url: string; method: string; merchant: string; description?: string; accepts: unknown; extensions?: unknown }) {
    this.db
      .prepare(
        `INSERT INTO resources (url, method, merchant, description, accepts, extensions, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET method=excluded.method, merchant=excluded.merchant, description=excluded.description,
         accepts=excluded.accepts, extensions=excluded.extensions, updated=excluded.updated`,
      )
      .run(r.url, r.method, r.merchant, r.description ?? null, JSON.stringify(r.accepts), r.extensions ? JSON.stringify(r.extensions) : null, Math.floor(Date.now() / 1000));
  }

  resources(): { url: string; method: string; merchant: string; description: string | null; accepts: unknown[]; extensions: unknown; updated: number }[] {
    return (this.db.prepare("SELECT * FROM resources ORDER BY url").all() as { url: string; method: string; merchant: string; description: string | null; accepts: string; extensions: string | null; updated: number }[]).map(
      (r) => ({ ...r, accepts: JSON.parse(r.accepts), extensions: r.extensions ? JSON.parse(r.extensions) : undefined }),
    );
  }

  logVoucher(channelId: string, requestId: string, resourceHash: string, cumulative: string, at: number) {
    this.db.prepare("INSERT INTO voucher_log (channel_id, request_id, resource_hash, cumulative, at) VALUES (?, ?, ?, ?, ?)").run(channelId.toLowerCase(), requestId, resourceHash, cumulative, at);
  }

  voucherLog(channelId?: string): import("./flight.js").VoucherLogRow[] {
    if (channelId) return this.db.prepare("SELECT * FROM voucher_log WHERE channel_id = ? ORDER BY id").all(channelId.toLowerCase()) as import("./flight.js").VoucherLogRow[];
    return this.db.prepare("SELECT * FROM voucher_log ORDER BY id").all() as import("./flight.js").VoucherLogRow[];
  }

  /** Voucher-log rows of a channel not yet covered by a flight record. */
  unrecordedVouchers(channelId: string): import("./flight.js").VoucherLogRow[] {
    const last = this.db.prepare("SELECT MAX(last_id) AS m FROM flight_records WHERE channel_id = ?").get(channelId.toLowerCase()) as { m: number | null };
    return this.db.prepare("SELECT * FROM voucher_log WHERE channel_id = ? AND id > ? ORDER BY id").all(channelId.toLowerCase(), last?.m ?? 0) as import("./flight.js").VoucherLogRow[];
  }

  insertFlightRecord(r: { claimTx: string; channelId: string; merkleRoot: string; count: number; firstId: number; lastId: number }) {
    this.db.prepare("INSERT OR IGNORE INTO flight_records (claim_tx, channel_id, merkle_root, count, first_id, last_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(r.claimTx, r.channelId.toLowerCase(), r.merkleRoot, r.count, r.firstId, r.lastId, Math.floor(Date.now() / 1000));
  }

  flightRecords(channelId?: string): { claim_tx: string; channel_id: string; merkle_root: string; count: number; first_id: number; last_id: number; at: number }[] {
    if (channelId) return this.db.prepare("SELECT * FROM flight_records WHERE channel_id = ? ORDER BY first_id").all(channelId.toLowerCase()) as never;
    return this.db.prepare("SELECT * FROM flight_records ORDER BY at").all() as never;
  }

  bump(k: string, by = 1) {
    this.db.prepare("INSERT INTO counters (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = v + excluded.v").run(k, by);
  }

  counter(k: string): number {
    const r = this.db.prepare("SELECT v FROM counters WHERE k = ?").get(k) as { v: number } | undefined;
    return r?.v ?? 0;
  }
}
