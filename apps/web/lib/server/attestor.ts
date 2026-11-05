import "server-only";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { whitechainSepolia } from "viem/chains";
import {
  initConfigDigest,
  leashDomain,
  leashFactoryAbi,
  leashTypes,
  leashVaultAbi,
  mandateChangeDigest,
  type MandateChangeMsg,
  type WorldApprovalMsg,
} from "@leash/sdk";
import { CHAIN_ID, FACILITATOR_URL, RPC_URL, WORLD, attestorKey, deployment, APP_URL } from "./env";
import { getApproval, getAttempt, insertAttempt, newId, now, setApproval, setAttempt, type AttemptRow } from "./db";
import { mintMockIdToken, pollDeviceToken, startDeviceAuth, validateIdToken } from "./world";

export const publicClient = createPublicClient({ chain: whitechainSepolia, transport: http(RPC_URL) });

const APPROVAL_TTL = 10 * 60; // WorldApproval deadline after the check
const CHANGE_TTL = 20 * 60; // MandateChange deadline (covers the World check + signing)
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export async function audit(kind: string, vault: string | null, data: Record<string, unknown>) {
  try {
    await fetch(`${FACILITATOR_URL}/audit`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.ADMIN_TOKEN ? { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {}) },
      body: json({ kind, vault, data }),
    });
  } catch {
    /* audit must never block the flow */
  }
}

// ------------------------------------------------------------------------------------------- start

export type StartedAttempt = {
  attemptId: string;
  mode: "world" | "mock";
  userCode: string | null;
  verificationUri: string | null;
  verificationUriComplete: string | null;
  expiresAt: number;
  change?: { action: number; data: Hex; nonce: string; deadline: string };
  changeHash?: Hex;
};

async function beginWorld(id: string, pinnedSub?: string) {
  if (WORLD.mode === "mock") {
    return {
      device_code: null,
      user_code: "MOCK-" + id.slice(0, 4).toUpperCase(),
      verification_uri: `${APP_URL}/world/mock`,
      verification_uri_complete: `${APP_URL}/world/mock?attempt=${id}`,
      expires_at: now() + 5 * 60,
      interval_s: 1,
    };
  }
  const d = await startDeviceAuth(pinnedSub);
  return {
    device_code: d.deviceCode,
    user_code: d.userCode,
    verification_uri: d.verificationUri,
    verification_uri_complete: d.verificationUriComplete,
    expires_at: now() + d.expiresIn,
    interval_s: d.interval,
  };
}

/** Start a World check bound to ONE pending approval. The server builds the exact change to be signed. */
export async function startApprovalAttempt(approvalId: string): Promise<StartedAttempt> {
  const a = getApproval(approvalId);
  if (!a) throw new Error("unknown approval");
  if (a.status !== "PENDING") throw new Error(`approval is ${a.status}`);
  const vault = getAddress(a.vault);
  const nonce = await publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "mandateNonce" });
  const change: MandateChangeMsg = { action: a.action, data: a.data as Hex, nonce, deadline: BigInt(now() + CHANGE_TTL) };
  const changeHash = mandateChangeDigest(CHAIN_ID, vault, change);
  const id = newId();
  const w = await beginWorld(id);
  insertAttempt({
    id,
    kind: "approval",
    approval_id: a.id,
    vault,
    change_json: json(change),
    change_hash: changeHash,
    started_at: now(),
    next_poll_at: now(),
    mode: WORLD.mode,
    status: "PENDING",
    ...w,
  });
  setApproval(a.id, { status: "APPROVING", attempt_id: id });
  return {
    attemptId: id,
    mode: WORLD.mode,
    userCode: w.user_code,
    verificationUri: w.verification_uri,
    verificationUriComplete: w.verification_uri_complete,
    expiresAt: w.expires_at,
    change: { action: change.action, data: change.data, nonce: change.nonce.toString(), deadline: change.deadline.toString() },
    changeHash,
  };
}

/** Start a World check for vault creation. The subject (and so the InitConfig digest) is fixed by the World login. */
export async function startCreateAttempt(input: { pqPubKeyHash: Hex; initialMandate: Hex }): Promise<StartedAttempt> {
  const id = newId();
  const w = await beginWorld(id);
  insertAttempt({
    id,
    kind: "create",
    approval_id: null,
    vault: null,
    change_json: json({ pqPubKeyHash: input.pqPubKeyHash, initialMandate: input.initialMandate, verifier: deployment.ethFalconVerifier }),
    change_hash: null,
    started_at: now(),
    next_poll_at: now(),
    mode: WORLD.mode,
    status: "PENDING",
    ...w,
  });
  return { attemptId: id, mode: WORLD.mode, userCode: w.user_code, verificationUri: w.verification_uri, verificationUriComplete: w.verification_uri_complete, expiresAt: w.expires_at };
}

// ------------------------------------------------------------------------------------------- advance

/** Poll the IdP (respecting interval/slow_down) and move the attempt forward. */
export async function advanceAttempt(id: string): Promise<AttemptRow> {
  const at = getAttempt(id);
  if (!at) throw new Error("unknown attempt");
  if (at.status !== "PENDING") return at;
  if (now() > at.expires_at) return fail(at, "EXPIRED", "the World check expired before it was completed");
  if (at.mode === "mock" || now() < at.next_poll_at || !at.device_code) return at;

  const r = await pollDeviceToken(at.device_code);
  if (r.state === "pending") {
    const interval = r.slowDown ? at.interval_s + 5 : at.interval_s;
    setAttempt(id, { interval_s: interval, next_poll_at: now() + interval });
    return getAttempt(id)!;
  }
  if (r.state === "denied") return fail(at, "DENIED", r.reason);
  if (r.state === "expired") return fail(at, "EXPIRED", r.reason);
  if (r.state === "error") return fail(at, "ERROR", r.reason);
  return complete(at, r.idToken, false);
}

/** MOCKED path: the local mock page approves or denies. Same validation + signing code as the real path. */
export async function mockDecision(id: string, decision: "approve" | "deny"): Promise<AttemptRow> {
  const at = getAttempt(id);
  if (!at || at.mode !== "mock") throw new Error("not a mock attempt");
  if (at.status !== "PENDING") return at;
  if (decision === "deny") return fail(at, "DENIED", "the owner cancelled the World check");
  return complete(at, await mintMockIdToken(id), true);
}

async function fail(at: AttemptRow, status: "DENIED" | "EXPIRED" | "ERROR", reason: string): Promise<AttemptRow> {
  setAttempt(at.id, { status, status_reason: reason, device_code: null });
  if (at.approval_id) {
    setApproval(at.approval_id, { status: status === "EXPIRED" ? "EXPIRED" : "DENIED", status_reason: `World check ${status.toLowerCase()}: ${reason}`, decided_at: now() });
  }
  await audit(status === "EXPIRED" ? "ApprovalExpired" : "ApprovalDenied", at.vault, { attemptId: at.id, approvalId: at.approval_id, reason, mode: at.mode });
  return getAttempt(at.id)!;
}

async function complete(at: AttemptRow, idToken: string, mocked: boolean): Promise<AttemptRow> {
  let who;
  try {
    who = await validateIdToken(idToken, at, mocked);
  } catch (e) {
    return fail(at, "DENIED", `ID token rejected: ${e instanceof Error ? e.message : e}`);
  }
  const account = privateKeyToAccount(attestorKey());
  const deadline = BigInt(now() + APPROVAL_TTL);

  let wa: WorldApprovalMsg;
  let verifyingContract: Address;
  let changeHash: Hex;
  let vault: Address;
  if (at.kind === "approval") {
    vault = getAddress(at.vault!);
    const subjectOnchain = await publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "worldSubjectHash" });
    if (subjectOnchain.toLowerCase() !== who.subjectHash.toLowerCase()) {
      return fail(at, "DENIED", "this World ID is not the one bound to the vault");
    }
    const change = JSON.parse(at.change_json!);
    changeHash = at.change_hash as Hex;
    wa = { vault, changeHash, nonce: BigInt(change.nonce), worldSubjectHash: who.subjectHash, authTime: BigInt(who.authTime), deadline };
    verifyingContract = vault;
  } else {
    const c = JSON.parse(at.change_json!) as { pqPubKeyHash: Hex; initialMandate: Hex; verifier: Address };
    const cfg = { pqPubKeyHash: c.pqPubKeyHash, worldSubjectHash: who.subjectHash, verifier: c.verifier, initialMandate: c.initialMandate };
    changeHash = initConfigDigest(CHAIN_ID, deployment.factory, cfg);
    vault = await publicClient.readContract({ address: deployment.factory, abi: leashFactoryAbi, functionName: "predictVaultFor", args: [cfg.pqPubKeyHash, cfg.worldSubjectHash] });
    wa = { vault, changeHash, nonce: 0n, worldSubjectHash: who.subjectHash, authTime: BigInt(who.authTime), deadline };
    verifyingContract = deployment.factory;
  }
  const sig = await account.signTypedData({ domain: leashDomain(CHAIN_ID, verifyingContract), types: leashTypes, primaryType: "WorldApproval", message: wa });
  setAttempt(at.id, {
    status: "APPROVED",
    status_reason: mocked ? "MOCKED World check (local issuer)" : "World ID verified",
    device_code: null,
    sub: who.sub,
    subject_hash: who.subjectHash,
    auth_time: who.authTime,
    acr: who.acr ?? null,
    amr: JSON.stringify(who.amr),
    jti: who.jti ?? null,
    wa_json: json(wa),
    attestor_sig: sig,
    vault,
    change_hash: changeHash,
  });
  await audit("ApprovalGranted", vault, { attemptId: at.id, approvalId: at.approval_id, authTime: who.authTime, acr: who.acr, mocked });
  return getAttempt(at.id)!;
}

/** What the browser may see about an attempt (never the device_code). */
export function publicAttempt(at: AttemptRow) {
  const wa = at.wa_json ? JSON.parse(at.wa_json) : null;
  let initConfig = null;
  if (at.kind === "create" && at.status === "APPROVED" && at.change_json) {
    const c = JSON.parse(at.change_json);
    initConfig = { ...c, worldSubjectHash: at.subject_hash };
  }
  return {
    attemptId: at.id,
    kind: at.kind,
    mode: at.mode,
    status: at.status,
    reason: at.status_reason,
    userCode: at.user_code,
    verificationUri: at.verification_uri,
    verificationUriComplete: at.verification_uri_complete,
    expiresAt: at.expires_at,
    vault: at.vault,
    changeHash: at.change_hash,
    change: at.kind === "approval" && at.change_json ? JSON.parse(at.change_json) : null,
    initConfig,
    authTime: at.auth_time,
    worldApproval: wa,
    consumed: Boolean(at.consumed),
  };
}

export async function relay<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${FACILITATOR_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: json(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`relay ${path} → ${r.status}: ${text}`);
  return JSON.parse(text) as T;
}
