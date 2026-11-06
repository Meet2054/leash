/**
 * Q-Day drill (feature F1): rotate the vault's post-quantum root key live, without moving funds.
 *   1. show the current owner Falcon pubKeyHash
 *   2. "the old key is compromised" → generate a NEW Falcon key
 *   3. ROTATE_PQ_KEY is loosening → World approval (attestor) + signature by the OLD key → relayed tx
 *   4. a change signed with the OLD key now fails (WrongPqKey; simulated, never sent)
 *   5. the NEW key works: a tightening change, relayed tx
 * Same vault address, same balance, same mandate. Uses the owner CLI vault (keys/owner.json).
 */
import { existsSync, renameSync } from "node:fs";
import { encodeFunctionData, erc20Abi, keccak256, type Abi, type Hex } from "viem";
import { EXPLORERS, encode, formatUnits6, leashVaultAbi, mandateChangeDigest } from "@leash/sdk";
import { OWNER_KEY, ensureOwnerKey, falconSign } from "./lib/falcon.js";
import { revertName } from "./lib/revert.js";
import { CHAIN_ID, FACILITATOR_URL, INBOX_URL, ROOT, deployment, loadVault, merchantAddresses, nowSec, post, publicClient, saveVault } from "./lib/config.js";

const c = { dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", bold: "\x1b[1m", reset: "\x1b[0m" };
const log = (s: string) => console.log(s);
const tx = (h: string) => EXPLORERS[CHAIN_ID]?.tx(h) ?? h;
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

async function web<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${INBOX_URL}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${t}`);
  return JSON.parse(t) as T;
}

export async function qdayDrill() {
  const v = loadVault();
  const read = <T,>(fn: string, args: unknown[] = []) => publicClient.readContract({ address: v.vault, abi: leashVaultAbi, functionName: fn as never, args: args as never }) as Promise<T>;
  const balance = () => publicClient.readContract({ address: deployment.token, abi: erc20Abi, functionName: "balanceOf", args: [v.vault] });

  log(`${c.bold}Q-Day drill — rotate the post-quantum root of vault ${v.vault}${c.reset}`);
  const oldKey = ensureOwnerKey();
  const onchainHash = await read<Hex>("pqPubKeyHash");
  if (onchainHash.toLowerCase() !== oldKey.pubKeyHash.toLowerCase()) throw new Error("keys/owner.json is not this vault's current PQ key");
  const bal0 = await balance();
  log(`  1. current Falcon root  ${onchainHash}   balance ${formatUnits6(bal0)} USDT`);

  // 2. new key (the old one is "compromised")
  const nextPath = `${ROOT}keys/owner-next.json`;
  if (existsSync(nextPath)) renameSync(nextPath, `${ROOT}keys/owner-next-stale-${Date.now()}.json`);
  const newKey = ensureOwnerKey(nextPath);
  log(`  2. "old key compromised" → new Falcon key generated  ${newKey.pubKeyHash}`);

  // 3. ROTATE_PQ_KEY (loosening): World approval via the attestor + OLD key signature
  const op = encode.rotatePqKey(newKey.pubKeyHash);
  const req = await web<{ id: string }>("/api/approvals", { vault: v.vault, op, reason: "Q-Day drill: rotate the post-quantum root key" });
  const start = await web<{ attemptId: string; mode: string; verificationUriComplete: string; userCode: string }>(`/api/approvals/${req.id}/start`, {});
  if (start.mode === "mock") {
    log(`${c.yellow}     World check MOCKED (WORLD_MODE=mock): approving on the local mock issuer${c.reset}`);
    await web(`/api/world/mock/${start.attemptId}`, { decision: "approve" });
  } else {
    log(`     → verify with World ID: ${start.verificationUriComplete}  (code ${start.userCode})`);
  }
  let at: { status: string; reason: string | null; change: { action: number; data: Hex; nonce: string; deadline: string } | null; changeHash: Hex };
  for (;;) {
    at = await web(`/api/world/attempts/${start.attemptId}`);
    if (at.status !== "PENDING") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (at.status !== "APPROVED" || !at.change) throw new Error(`World check ${at.status}: ${at.reason}`);
  const rotChange = { action: at.change.action, data: at.change.data, nonce: BigInt(at.change.nonce), deadline: BigInt(at.change.deadline) };
  const rotDigest = mandateChangeDigest(CHAIN_ID, v.vault, rotChange);
  if (rotDigest.toLowerCase() !== at.changeHash.toLowerCase()) throw new Error("change hash mismatch");
  const rot = await web<{ txHash: Hex; gasUsed: string }>(`/api/approvals/${req.id}/submit`, { pqPubKey: oldKey.pubKey, pqSig: falconSign(rotDigest, OWNER_KEY) });
  log(`${c.green}  3. ROTATE_PQ_KEY applied (World approval + OLD-key Falcon signature, gas ${rot.gasUsed}): ${tx(rot.txHash)}${c.reset}`);

  // promote the new key locally; keep the retired one for the demo's "old key" step
  const retiredPath = `${ROOT}keys/owner-retired-${Date.now()}.json`;
  renameSync(OWNER_KEY, retiredPath);
  renameSync(nextPath, OWNER_KEY);
  saveVault({ ...v, pqPubKeyHash: newKey.pubKeyHash });

  // 4. old key now refused (simulate only — never broadcast a reverting tx)
  const m = merchantAddresses();
  const [, , dailyCap, , maxChannel] = await read<readonly [boolean, bigint, bigint, bigint, bigint]>("merchants", [m.quote]);
  const tighten = encode.setMerchant(m.quote, dailyCap - 10_000n, maxChannel); // lower the quote merchant's daily cap by 0.01 USDT
  const nonce = await read<bigint>("mandateNonce");
  const change = { action: tighten.action, data: tighten.data, nonce, deadline: nowSec() + 600n };
  const digest = mandateChangeDigest(CHAIN_ID, v.vault, change);
  const zero32 = `0x${"0".repeat(64)}` as Hex;
  const emptyWa = { vault: "0x0000000000000000000000000000000000000000" as const, changeHash: zero32, nonce: 0n, worldSubjectHash: zero32, authTime: 0n, deadline: 0n };
  try {
    await publicClient.call({
      to: v.vault,
      data: encodeFunctionData({ abi: leashVaultAbi, functionName: "applyChange", args: [change, oldKey.pubKey, falconSign(digest, retiredPath), emptyWa, "0x"] }),
    });
    log(`${c.red}  4. !! old key was accepted${c.reset}`);
  } catch (e) {
    log(`${c.green}  4. a change signed with the OLD key → ${revertName(e, leashVaultAbi as Abi)} (simulated, never sent)${c.reset}`);
  }

  // 5. new key works (tightening: PQ signature only, no World check)
  const r = await post<{ txHash: Hex; gasUsed: string }>(`${FACILITATOR_URL}/relay/applyChange`, {
    vault: v.vault,
    change,
    pqPubKey: newKey.pubKey,
    pqSig: falconSign(digest, OWNER_KEY),
    wa: null,
    attestorSig: "0x",
  });
  log(`${c.green}  5. NEW key signs a tightening change (quote merchant daily cap −0.01 USDT, gas ${r.gasUsed}): ${tx(r.txHash)}${c.reset}`);

  const after = await read<Hex>("pqPubKeyHash");
  const bal1 = await balance();
  log(`${c.bold}  same vault ${short(v.vault)} · balance ${formatUnits6(bal1)} USDT (unchanged: ${bal1 === bal0}) · root ${short(onchainHash)} → ${short(after)} (= new key: ${after.toLowerCase() === keccak256(newKey.pubKey).toLowerCase()})${c.reset}`);
  log(`${c.dim}  retired key kept at ${retiredPath} (gitignored). Restart \`pnpm owner-signer\` to serve the new key.${c.reset}`);
  return { rotationTx: rot.txHash, tighteningTx: r.txHash };
}

/** Re-check (demo-friendly): a tightening change signed with the most recently retired key is refused onchain. */
export async function qdayCheckOldKey() {
  const { readdirSync } = await import("node:fs");
  const retired = readdirSync(`${ROOT}keys`).filter((f) => f.startsWith("owner-retired-")).sort().pop();
  if (!retired) throw new Error("no retired key yet: run the Q-Day drill first");
  const path = `${ROOT}keys/${retired}`;
  const v = loadVault();
  const old = ensureOwnerKey(path);
  const op = encode.revokeSession("0x000000000000000000000000000000000000dEaD"); // harmless tightening shape
  const nonce = await publicClient.readContract({ address: v.vault, abi: leashVaultAbi, functionName: "mandateNonce" });
  const change = { action: op.action, data: op.data, nonce, deadline: nowSec() + 600n };
  const zero32 = `0x${"0".repeat(64)}` as Hex;
  try {
    await publicClient.call({
      to: v.vault,
      data: encodeFunctionData({
        abi: leashVaultAbi,
        functionName: "applyChange",
        args: [change, old.pubKey, falconSign(mandateChangeDigest(CHAIN_ID, v.vault, change), path), { vault: "0x0000000000000000000000000000000000000000", changeHash: zero32, nonce: 0n, worldSubjectHash: zero32, authTime: 0n, deadline: 0n }, "0x"],
      }),
    });
    log(`${c.red}!! the retired key was accepted${c.reset}`);
  } catch (e) {
    log(`${c.green}retired Falcon key ${short(old.pubKeyHash)} → ${revertName(e, leashVaultAbi as Abi)} (simulated against vault ${short(v.vault)}, never sent)${c.reset}`);
  }
}
