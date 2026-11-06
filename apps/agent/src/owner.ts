/**
 * Owner CLI — the owner's post-quantum (ETHFALCON) key never leaves this machine; every action is relayed,
 * so the owner never sends a gas-paying transaction.
 *
 *   owner init                       generate the Falcon owner key + agent session key
 *   owner address                    show the counterfactual vault (USDT deposit) address
 *   owner create-vault [--attest local]
 *   owner status
 *   owner set-session-cap <usdt> [--attest local]      (loosening if higher → needs World approval)
 *   owner revoke-session [address]                       (tightening: PQ signature only)
 *   owner withdraw <usdt> <to> [--attest local]
 *
 * --attest local: sign the WorldApproval with ATTESTOR_PK directly. This SKIPS the World ID check and is
 * labelled MOCKED; the real path is the owner app's approval flow (World Agent Pass → attestor API).
 */
import { formatUnits, getAddress, type Address, type Hex } from "viem";
import {
  Action,
  describeOp,
  encode,
  encodeOps,
  formatUnits6,
  initConfigDigest,
  leashFactoryAbi,
  leashVaultAbi,
  mandateChangeDigest,
  parseUnits6,
  worldApprovalDigest,
  EXPLORERS,
  type Op,
} from "@leash/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { ensureOwnerKey, falconSign } from "./lib/falcon.js";
import {
  CHAIN_ID,
  FACILITATOR_URL,
  INBOX_URL,
  agentSession,
  deployment,
  loadVault,
  merchantAddresses,
  nowSec,
  post,
  publicClient,
  saveVault,
  subjectHash,
  vaultRecordPath,
} from "./lib/config.js";

const [, , cmd, ...args] = process.argv;
const flag = (name: string) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;
const tx = (h: string) => EXPLORERS[CHAIN_ID]?.tx(h) ?? h;

const DEMO = {
  sessionCap: parseUnits6(process.env.DEMO_SESSION_CAP ?? "5"),
  sessionTtl: 24n * 3600n,
  merchantDaily: parseUnits6(process.env.DEMO_MERCHANT_DAILY ?? "10"),
  merchantMaxChannel: parseUnits6(process.env.DEMO_MERCHANT_MAX_CHANNEL ?? "1"),
};

function worldSubject() {
  return process.env.WORLD_SUBJECT ?? "cli-bootstrap:owner-1";
}

function localAttest(verifyingContract: Address, wa: { vault: Address; changeHash: Hex; nonce: bigint; worldSubjectHash: Hex; authTime: bigint; deadline: bigint }) {
  const pk = process.env.ATTESTOR_PK as Hex;
  if (!pk) throw new Error("ATTESTOR_PK missing");
  console.log("  ⚠ World approval MOCKED: attestor key signed locally without a World ID check (--attest local)");
  return privateKeyToAccount(pk).sign({ hash: worldApprovalDigest(CHAIN_ID, verifyingContract, wa) });
}

async function predicted(pqPubKeyHash: Hex, wsh: Hex) {
  return publicClient.readContract({ address: deployment.factory, abi: leashFactoryAbi, functionName: "predictVaultFor", args: [pqPubKeyHash, wsh] });
}

async function cmdInit() {
  const k = ensureOwnerKey();
  const s = agentSession();
  console.log(`owner Falcon pubKeyHash ${k.pubKeyHash} (1024-byte key in keys/owner.json)`);
  console.log(`agent session ${s.address} (keys/agent-session.json, holds no gas)`);
}

async function cmdAddress() {
  const k = ensureOwnerKey();
  const v = await predicted(k.pubKeyHash, subjectHash(worldSubject()));
  console.log(`vault (deposit address) ${v}\n  ${EXPLORERS[CHAIN_ID]?.address(v)}`);
}

async function cmdCreateVault() {
  const k = ensureOwnerKey();
  const session = agentSession();
  const m = merchantAddresses();
  const wsh = subjectHash(worldSubject());
  const ops: Op[] = [
    encode.setMerchant(m.quote, DEMO.merchantDaily, DEMO.merchantMaxChannel),
    encode.setMerchant(m.translate, DEMO.merchantDaily, DEMO.merchantMaxChannel),
    encode.setMerchant(m.summarize, DEMO.merchantDaily, DEMO.merchantMaxChannel),
    encode.addSession(session.address, nowSec() + DEMO.sessionTtl, DEMO.sessionCap),
  ];
  const cfg = { pqPubKeyHash: k.pubKeyHash, worldSubjectHash: wsh, verifier: deployment.ethFalconVerifier, initialMandate: encodeOps(ops) };
  const vault = await predicted(k.pubKeyHash, wsh);
  console.log(`creating vault ${vault}`);
  for (const op of ops) console.log(`  · ${describeOp(op, (a) => `${formatUnits6(a)} USDT`)}`);
  if (flag("attest") === "world") return createVaultWithWorld(k, ops);
  const digest = initConfigDigest(CHAIN_ID, deployment.factory, cfg);
  console.log("  signing InitConfig with the owner's ETHFALCON key…");
  const pqSig = falconSign(digest);
  const wa = { vault, changeHash: digest, nonce: 0n, worldSubjectHash: wsh, authTime: nowSec(), deadline: nowSec() + 600n };
  if (flag("attest") !== "local") throw new Error("use --attest world (real World ID via the attestor) or --attest local (MOCKED)");
  const attestorSig = await localAttest(deployment.factory, wa);
  const r = await post<{ vault: Address; txHash: Hex; gasUsed: string }>(`${FACILITATOR_URL}/relay/createVault`, { cfg, pqPubKey: k.pubKey, pqSig, wa, attestorSig });
  saveVault({ vault: r.vault, worldSubjectHash: wsh, worldSubject: worldSubject(), pqPubKeyHash: k.pubKeyHash, createdTx: r.txHash, mockedWorld: true });
  console.log(`✔ vault created by the relayer (gas ${r.gasUsed}): ${tx(r.txHash)}\n  saved ${vaultRecordPath()}\n  → send USDT to ${r.vault}`);
}

/** Real World ID onboarding through the attestor API: the World login fixes the subject and so the vault address. */
async function createVaultWithWorld(k: { pubKey: Hex; pubKeyHash: Hex }, ops: Op[]) {
  type Start = { attemptId: string; mode: string; userCode: string; verificationUri: string; verificationUriComplete: string; expiresAt: number };
  const s = await web<Start>("/api/onboard/start", { pqPubKeyHash: k.pubKeyHash, initialMandate: encodeOps(ops) });
  console.log(`\n  ┌─ World ID check (${s.mode === "mock" ? "MOCKED issuer" : "World IdP sandbox"}) ─────────────────────────`);
  console.log(`  │ open on your phone:  ${s.verificationUriComplete}`);
  console.log(`  │ or go to ${s.verificationUri} and enter code  ${s.userCode}`);
  console.log(`  │ expires ${new Date(s.expiresAt * 1000).toLocaleTimeString()}`);
  console.log("  └──────────────────────────────────────────────────────────────\n  waiting for you to verify…");
  type Att = { status: string; reason: string | null; changeHash: Hex; vault: Address; authTime: number; initConfig: { pqPubKeyHash: Hex; worldSubjectHash: Hex; verifier: Address; initialMandate: Hex } | null };
  let at: Att;
  for (;;) {
    at = await web<Att>(`/api/world/attempts/${s.attemptId}`);
    if (at.status !== "PENDING") break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (at.status !== "APPROVED" || !at.initConfig) {
    console.log(`  ✋ World check ${at.status}: ${at.reason} — nothing was signed, no vault was created`);
    return;
  }
  console.log(`  ✓ World ID verified (auth_time ${new Date(at.authTime * 1000).toLocaleTimeString()}); subject bound: ${at.initConfig.worldSubjectHash}`);
  const digest = initConfigDigest(CHAIN_ID, deployment.factory, at.initConfig);
  if (digest.toLowerCase() !== at.changeHash.toLowerCase()) throw new Error("InitConfig hash mismatch — refusing to sign");
  console.log(`  signing InitConfig with the owner's ETHFALCON key…`);
  const r = await web<{ vault: Address; txHash: Hex; gasUsed: string; mocked: boolean }>(`/api/onboard/${s.attemptId}/create`, { pqPubKey: k.pubKey, pqSig: falconSign(digest) });
  saveVault({ vault: r.vault, worldSubjectHash: at.initConfig.worldSubjectHash, worldSubject: r.mocked ? "(mock issuer)" : "(World IdP sandbox, pairwise sub)", pqPubKeyHash: k.pubKeyHash, createdTx: r.txHash, mockedWorld: r.mocked });
  console.log(`✔ vault created after a ${r.mocked ? "MOCKED" : "REAL"} World ID check (gas ${r.gasUsed}): ${tx(r.txHash)}\n  vault ${r.vault} · record ${vaultRecordPath()}`);
}

async function applyChange(op: Op, attest?: string) {
  const v = loadVault();
  const k = ensureOwnerKey();
  const nonce = await publicClient.readContract({ address: v.vault, abi: leashVaultAbi, functionName: "mandateNonce" });
  const change = { action: op.action, data: op.data, nonce, deadline: nowSec() + 600n };
  const loosening = await publicClient.readContract({ address: v.vault, abi: leashVaultAbi, functionName: "isLoosening", args: [op.action, op.data] });
  console.log(`${loosening ? "LOOSENING" : "tightening"}: ${describeOp(op, (a) => `${formatUnits6(a)} USDT`)}`);
  const digest = mandateChangeDigest(CHAIN_ID, v.vault, change);
  console.log("  signing MandateChange with the owner's ETHFALCON key…");
  const pqSig = falconSign(digest);
  let wa = null;
  let attestorSig: Hex = "0x";
  if (loosening) {
    if (attest !== "local") throw new Error("loosening needs a World approval: use the owner app, or --attest local (MOCKED)");
    wa = { vault: v.vault, changeHash: digest, nonce, worldSubjectHash: v.worldSubjectHash, authTime: nowSec(), deadline: nowSec() + 600n };
    attestorSig = await localAttest(v.vault, wa);
  }
  const r = await post<{ txHash: Hex; gasUsed: string }>(`${FACILITATOR_URL}/relay/applyChange`, { vault: v.vault, change, pqPubKey: k.pubKey, pqSig, wa, attestorSig });
  console.log(`✔ applied (gas ${r.gasUsed}): ${tx(r.txHash)}`);
}

async function cmdStatus() {
  const v = loadVault();
  const s = agentSession();
  const m = merchantAddresses();
  const read = <T>(functionName: string, a: unknown[] = []) =>
    publicClient.readContract({ address: v.vault, abi: leashVaultAbi, functionName: functionName as never, args: a as never }) as Promise<T>;
  const [bal, free, locked, nonce, sess] = await Promise.all([
    publicClient.readContract({ address: deployment.token, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [v.vault] }),
    read<bigint>("freeBalance"),
    read<bigint>("totalLocked"),
    read<bigint>("mandateNonce"),
    read<readonly [bigint, boolean, bigint, bigint, bigint]>("sessions", [s.address]),
  ]);
  console.log(`vault ${v.vault}  (${EXPLORERS[CHAIN_ID]?.address(v.vault)})`);
  console.log(`  USDT ${formatUnits(bal, 6)} | free ${formatUnits(free, 6)} | locked ${formatUnits(locked, 6)} | mandateNonce ${nonce}`);
  console.log(`  World subject ${v.worldSubject}${v.mockedWorld ? " (MOCKED bootstrap)" : ""}`);
  console.log(`  session ${s.address}: cap ${formatUnits(sess[2], 6)} locked ${formatUnits(sess[3], 6)} spent ${formatUnits(sess[4], 6)} revoked ${sess[1]} expires ${new Date(Number(sess[0]) * 1000).toISOString()}`);
  for (const [name, a] of Object.entries(m)) {
    const r = await read<readonly [boolean, bigint, bigint, bigint, bigint]>("merchants", [a]);
    console.log(`  merchant ${name} ${a}: allowed ${r[0]} daily ${formatUnits(r[2], 6)} (today ${formatUnits(r[3], 6)}) maxChannel ${formatUnits(r[4], 6)}`);
  }
  console.log(`  agent WBT balance: ${formatUnits(await publicClient.getBalance({ address: s.address }), 18)} (never funded)`);
}

// ------------------------------------------------------------------ scripted owner decisions (same API as the phone UI)

type ApprovalView = { id: string; status: string; description: string; reason: string; source: string };
type AttemptView = { status: string; reason: string | null; verificationUriComplete: string | null; userCode: string | null; mode: string; changeHash: Hex; change: { action: number; data: Hex; nonce: string; deadline: string } | null; vault: Address };

async function web<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${INBOX_URL}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${t}`);
  return JSON.parse(t) as T;
}

async function latestPending(): Promise<ApprovalView> {
  const list = await web<ApprovalView[]>(`/api/approvals?vault=${loadVault().vault}`);
  const p = list.find((a) => a.status === "PENDING");
  if (!p) throw new Error("no pending approval");
  return p;
}

async function cmdApprovals() {
  for (const a of await web<ApprovalView[]>(`/api/approvals?vault=${loadVault().vault}`)) console.log(`${a.id}  ${a.status.padEnd(9)} ${a.source.padEnd(5)} ${a.description}  — “${a.reason}”`);
}

async function cmdDeny(id?: string) {
  const a = id ? { id } : await latestPending();
  const r = await web<{ status: string }>(`/api/approvals/${a.id}/deny`, {});
  console.log(`✋ ${a.id} → ${r.status} (nothing signed, nothing onchain)`);
}

async function cmdApprove(id?: string) {
  const a = id ? { id } : await latestPending();
  const v = loadVault();
  const k = ensureOwnerKey();
  const s = await web<{ attemptId: string; mode: string; verificationUriComplete: string; userCode: string }>(`/api/approvals/${a.id}/start`, {});
  if (s.mode === "mock") {
    console.log("  ⚠ World check MOCKED (WORLD_MODE=mock): approving on the local mock issuer");
    await web(`/api/world/mock/${s.attemptId}`, { decision: process.env.WORLD_MOCK_DECISION ?? "approve" });
  } else {
    console.log(`  → verify with World ID: ${s.verificationUriComplete}  (code ${s.userCode})`);
  }
  let at: AttemptView;
  for (;;) {
    at = await web<AttemptView>(`/api/world/attempts/${s.attemptId}`);
    if (at.status !== "PENDING") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (at.status !== "APPROVED" || !at.change) {
    console.log(`  ✕ World check ${at.status}: ${at.reason} — nothing signed`);
    return;
  }
  const change = { action: at.change.action, data: at.change.data, nonce: BigInt(at.change.nonce), deadline: BigInt(at.change.deadline) };
  const digest = mandateChangeDigest(CHAIN_ID, v.vault, change);
  if (digest.toLowerCase() !== at.changeHash.toLowerCase()) throw new Error("change hash mismatch — refusing to sign");
  console.log("  ✓ World check passed; signing the change with the owner's ETHFALCON key…");
  const r = await web<{ txHash: Hex; gasUsed: string }>(`/api/approvals/${a.id}/submit`, { pqPubKey: k.pubKey, pqSig: falconSign(digest) });
  console.log(`✔ approved + applied onchain (gas ${r.gasUsed}): ${tx(r.txHash)}`);
}

const main = async () => {
  switch (cmd) {
    case "approvals":
      return cmdApprovals();
    case "freeze": {
      // F2: revoke every session involved in a breaker incident (or the CLI agent session) — tightening, PQ only
      const v = loadVault();
      const st = (await (await fetch(`${FACILITATOR_URL}/breaker?vault=${v.vault}`)).json()) as { sessionsSeen?: string[] };
      const sessions = (st.sessionsSeen?.length ? st.sessionsSeen : [agentSession().address]).map((s) => getAddress(s));
      const ops = sessions.map((s) => encode.revokeSession(s));
      return applyChange(ops.length === 1 ? ops[0] : encode.batch(ops));
    }
    case "deny":
      return cmdDeny(args[0]);
    case "approve":
      return cmdApprove(args[0]);
    case "init":
      return cmdInit();
    case "address":
      return cmdAddress();
    case "create-vault":
      return cmdCreateVault();
    case "status":
      return cmdStatus();
    case "set-session-cap": {
      const s = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
      if (!s) throw new Error("usage: owner set-session-cap <usdt>");
      const sess = agentSession();
      const cur = await publicClient.readContract({ address: loadVault().vault, abi: leashVaultAbi, functionName: "sessions", args: [sess.address] });
      return applyChange(encode.setSessionLimits(sess.address, BigInt(cur[0]), parseUnits6(s)), flag("attest"));
    }
    case "revoke-session":
      return applyChange(encode.revokeSession(args[0] && !args[0].startsWith("--") ? getAddress(args[0]) : agentSession().address));
    case "withdraw":
      return applyChange(encode.withdraw(getAddress(args[1]), parseUnits6(args[0])), flag("attest"));
    default:
      console.log("commands: init | address | create-vault --attest local | status | set-session-cap <usdt> | revoke-session [addr] | withdraw <usdt> <to> | freeze | approvals | approve | deny");
      void Action;
  }
};
main().catch((e) => {
  console.error("✘", e instanceof Error ? e.message : e);
  process.exit(1);
});
