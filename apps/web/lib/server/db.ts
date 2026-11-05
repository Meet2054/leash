import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./env";

export type ApprovalStatus = "PENDING" | "APPROVING" | "APPROVED" | "DENIED" | "EXPIRED" | "FAILED";
export type AttemptStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "ERROR";

export type ApprovalRow = {
  id: string;
  source: "agent" | "owner";
  vault: string;
  session: string | null;
  action: number;
  data: string;
  reason: string;
  request_sig: string | null;
  status: ApprovalStatus;
  status_reason: string | null;
  created_at: number;
  decided_at: number | null;
  tx: string | null;
  attempt_id: string | null;
};

export type AttemptRow = {
  id: string;
  kind: "approval" | "create";
  approval_id: string | null;
  vault: string | null;
  change_json: string | null; // MandateChange (approval) or InitConfig sans subject (create)
  change_hash: string | null;
  started_at: number;
  expires_at: number;
  next_poll_at: number;
  interval_s: number;
  device_code: string | null; // server-only, never returned to the client
  user_code: string | null;
  verification_uri: string | null;
  verification_uri_complete: string | null;
  mode: "world" | "mock";
  status: AttemptStatus;
  status_reason: string | null;
  sub: string | null;
  subject_hash: string | null;
  auth_time: number | null;
  acr: string | null;
  amr: string | null;
  jti: string | null;
  wa_json: string | null;
  attestor_sig: string | null;
  consumed: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, vault TEXT NOT NULL, session TEXT, action INTEGER NOT NULL, data TEXT NOT NULL,
  reason TEXT NOT NULL, request_sig TEXT, status TEXT NOT NULL, status_reason TEXT, created_at INTEGER NOT NULL,
  decided_at INTEGER, tx TEXT, attempt_id TEXT
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, approval_id TEXT, vault TEXT, change_json TEXT, change_hash TEXT,
  started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, next_poll_at INTEGER NOT NULL, interval_s INTEGER NOT NULL,
  device_code TEXT, user_code TEXT, verification_uri TEXT, verification_uri_complete TEXT, mode TEXT NOT NULL,
  status TEXT NOT NULL, status_reason TEXT, sub TEXT, subject_hash TEXT, auth_time INTEGER, acr TEXT, amr TEXT,
  jti TEXT UNIQUE, wa_json TEXT, attestor_sig TEXT, consumed INTEGER NOT NULL DEFAULT 0
);
`;

const g = globalThis as unknown as { __leashDb?: DatabaseSync };
export function db(): DatabaseSync {
  if (!g.__leashDb) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    g.__leashDb = new DatabaseSync(DB_PATH);
    g.__leashDb.exec("PRAGMA journal_mode = WAL;");
    g.__leashDb.exec(SCHEMA);
  }
  return g.__leashDb;
}

export const now = () => Math.floor(Date.now() / 1000);
export const newId = () => crypto.randomUUID();

export function getApproval(id: string) {
  return db().prepare("SELECT * FROM approvals WHERE id = ?").get(id) as ApprovalRow | undefined;
}
export function listApprovals(vault?: string) {
  if (vault) return db().prepare("SELECT * FROM approvals WHERE vault = ? ORDER BY created_at DESC LIMIT 100").all(vault.toLowerCase()) as ApprovalRow[];
  return db().prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100").all() as ApprovalRow[];
}
export function insertApproval(a: Omit<ApprovalRow, "status_reason" | "decided_at" | "tx" | "attempt_id">) {
  db()
    .prepare("INSERT INTO approvals (id, source, vault, session, action, data, reason, request_sig, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(a.id, a.source, a.vault.toLowerCase(), a.session, a.action, a.data, a.reason, a.request_sig, a.status, a.created_at);
}
export function setApproval(id: string, patch: Partial<Pick<ApprovalRow, "status" | "status_reason" | "decided_at" | "tx" | "attempt_id">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  db()
    .prepare(`UPDATE approvals SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => (patch[k] ?? null) as string | number | null), id);
}

export function getAttempt(id: string) {
  return db().prepare("SELECT * FROM attempts WHERE id = ?").get(id) as AttemptRow | undefined;
}
export function insertAttempt(a: Pick<AttemptRow, "id" | "kind" | "approval_id" | "vault" | "change_json" | "change_hash" | "started_at" | "expires_at" | "next_poll_at" | "interval_s" | "device_code" | "user_code" | "verification_uri" | "verification_uri_complete" | "mode" | "status">) {
  db()
    .prepare(
      `INSERT INTO attempts (id, kind, approval_id, vault, change_json, change_hash, started_at, expires_at, next_poll_at, interval_s,
        device_code, user_code, verification_uri, verification_uri_complete, mode, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(a.id, a.kind, a.approval_id, a.vault, a.change_json, a.change_hash, a.started_at, a.expires_at, a.next_poll_at, a.interval_s, a.device_code, a.user_code, a.verification_uri, a.verification_uri_complete, a.mode, a.status);
}
export function setAttempt(id: string, patch: Partial<Omit<AttemptRow, "id">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  db()
    .prepare(`UPDATE attempts SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => (patch[k] ?? null) as string | number | null), id);
}

/** Atomically mark an approved attempt as used. Returns false if it was already consumed. */
export function consumeAttempt(id: string): boolean {
  const r = db().prepare("UPDATE attempts SET consumed = 1 WHERE id = ? AND consumed = 0 AND status = 'APPROVED'").run(id);
  return Number(r.changes) === 1;
}
