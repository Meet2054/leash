/**
 * Demo: the agent's key is stolen (compromised laptop, server, plugin or dashboard). No AI is involved, so the
 * model's judgment doesn't matter. Real Whitechain testnet transactions.
 *   WITHOUT LEASH: the ordinary agent wallet's key IS the money. The software "spending limit" never applies.
 *   WITH LEASH:    the agent's session key holds nothing; it can only act inside the vault contract's rules.
 *   tsx scripts/steal-key.ts <attacker> <leashVault>
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { whitechainSepolia } from "viem/chains";
import { createSession, encode, leashDomain, leashTypes, leashVaultAbi, parseUnits6, signOpenChannel } from "@leash/sdk";

const [attackerIn, vaultIn] = process.argv.slice(2);
const attacker = getAddress(attackerIn);
const vault = getAddress(vaultIn);
const USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" as const;
const FAC = "https://facilitator.permissionless.in";
const transport = http(process.env.WHITECHAIN_RPC ?? "https://rpc.testnet.whitechain.io");
const pub = createPublicClient({ chain: whitechainSepolia, transport });
const B = "\x1b[1m", R = "\x1b[31m", G = "\x1b[32m", D = "\x1b[2m", X = "\x1b[0m";
const usdt = async (a: Address) => formatUnits(await pub.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [a] }), 6);
const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const t = await r.text();
  return { ok: r.ok, why: t.match(/simulation_reverted: (\w+)/)?.[1] ?? t.match(/"error":"(\w+)"/)?.[1] ?? t.slice(0, 100) };
};

console.log(`${B}Scenario: an attacker copies the AI agent's key file (stolen laptop, leaked server, malicious plugin).${X}\n${D}No AI in the loop — the model's judgment can't help here.${X}\n`);

// ------------------------------------------------------------------ WITHOUT LEASH
console.log(`${B}${R}━━ WITHOUT LEASH: ordinary agent wallet ━━${X}`);
const plainKey = JSON.parse(readFileSync(join(homedir(), ".plain-wallet", "key.json"), "utf8")).privateKey as Hex;
const thief = privateKeyToAccount(plainKey);
const plainState = JSON.parse(readFileSync(join(homedir(), ".plain-wallet", "state.json"), "utf8"));
const bal = await pub.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [thief.address] });
console.log(`stolen key controls wallet ${thief.address}: ${formatUnits(bal, 6)} USDT · its "spending limit" says ${plainState.limitUsdt} USDT`);
if (bal > 0n) {
  const w = createWalletClient({ account: thief, chain: whitechainSepolia, transport });
  const hash = await w.writeContract({ address: USDT, abi: erc20Abi, functionName: "transfer", args: [attacker, bal] });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`${R}${B}→ DRAINED: all ${formatUnits(bal, 6)} USDT sent to the attacker in one transaction. The software limit never ran.${X}\n  https://explorer.testnet.whitechain.io/tx/${hash}\n`);
} else console.log(`${D}(wallet already empty — refill it to rerun)${X}\n`);

// ------------------------------------------------------------------ WITH LEASH
console.log(`${B}${G}━━ WITH LEASH: the agent's key is stolen the same way ━━${X}`);
const session = createSession(JSON.parse(readFileSync(join(homedir(), ".leash", "agent-key.json"), "utf8")).privateKey as Hex);
const [expiry, revoked, cap, locked, spent] = await pub.readContract({ address: vault, abi: leashVaultAbi, functionName: "sessions", args: [session.address] });
console.log(`stolen key ${session.address} holds ${await usdt(session.address)} USDT and ${formatUnits(await pub.getBalance({ address: session.address }), 18)} WBT — the money is in the vault ${vault} (${await usdt(vault)} USDT)`);
console.log(`${D}vault rules for this key: cap ${formatUnits(cap, 6)} USDT, used ${formatUnits(locked + spent, 6)}, ${revoked ? "REVOKED" : "active"} until ${new Date(Number(expiry) * 1000).toISOString()}${X}`);
const now = BigInt(Math.floor(Date.now() / 1000));
const exp = expiry < now + 3600n ? expiry : now + 3600n;
const open = async (merchant: Address, amount: bigint) => {
  const req = { vault, merchant, amount, expiry: exp, sessionNonce: now * 1000n + BigInt(Math.floor(Math.random() * 999)) };
  return post(`${FAC}/channels/open`, { chainId: 1874, request: req, sig: await signOpenChannel(session, 1874, req) });
};
let r = await open(attacker, parseUnits6("1"));
console.log(`  send vault USDT to the attacker        → ${r.ok ? `${R}OPENED` : `${G}blocked (${r.why})`}${X}`);
r = await open("0x3425bC52cd7f10F1221eF2708321b4b0924d431D", parseUnits6("1"));
console.log(`  reserve more at an allowed shop        → ${r.ok ? `${D}opened (inside the cap)` : `${G}blocked (${r.why})`}${X}`);
const nonce = await pub.readContract({ address: vault, abi: leashVaultAbi, functionName: "mandateNonce" });
const op = encode.setSessionLimits(session.address, expiry, parseUnits6("500"));
const change = { action: op.action, data: op.data, nonce, deadline: now + 600n };
const sig = await session.account.signTypedData({ domain: leashDomain(1874, vault), types: { MandateChange: leashTypes.MandateChange }, primaryType: "MandateChange", message: change });
r = await post(`${FAC}/relay/applyChange`, { vault, change, pqPubKey: session.address, pqSig: sig, wa: null, attestorSig: "0x" });
console.log(`  raise its own cap to 500 USDT          → ${r.ok ? `${R}CHANGED` : `${G}blocked (${r.why})`}${X}`);
console.log(`  transfer USDT straight from the vault  → ${G}impossible: the vault has no function a session key can call to send funds${X}`);
console.log(`${G}${B}→ HELD: 0 USDT to the attacker. Worst case is the cap left at shops the owner allowed, and the owner can freeze the key with one tap.${X}`);
process.exit(0);
