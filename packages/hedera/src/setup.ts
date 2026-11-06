/**
 * One-time Hedera testnet setup from the single operator account in .env (HEDERA_OPERATOR_ID/KEY):
 *   1. HCS audit topic (writes HCS_TOPIC_ID into .env — a public id, not a secret)
 *   2. an agent (payer) account and a merchant (payTo) account, ECDSA, unlimited auto-association, 0 HBAR
 *   3. fund the agent with USDC from the operator (run again with --fund once the operator has USDC)
 * Keys for the two new accounts go to keys/hedera-demo.json (gitignored). Nothing leaves this machine
 * except the transactions themselves.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { AccountCreateTransaction, AccountId, Hbar, PrivateKey, TokenId, TransferTransaction } from "@hiero-ledger/sdk";
import { HEDERA_STATE, ROOT, loadHederaState, type HederaDemoState } from "./config";
import { createAuditTopic, hashscan, operatorClient } from "./hcs";
import { HEDERA_USDC_TESTNET } from "./facilitator";
const USDC = process.env.HEDERA_USDC_TOKEN_ID ?? HEDERA_USDC_TESTNET;

const opId = process.env.HEDERA_OPERATOR_ID;
const opKey = process.env.HEDERA_OPERATOR_KEY;
if (!opId || !opKey || opKey.includes("placeholder")) throw new Error("set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env");
const fundUsdc = process.argv.includes("--fund") ? BigInt(process.argv[process.argv.indexOf("--fund") + 1] ?? "5000000") : 0n;
const fundHbar = process.argv.includes("--fund-hbar") ? Number(process.argv[process.argv.indexOf("--fund-hbar") + 1] ?? "20") : 0;

const client = operatorClient(opId, opKey);

async function newAccount(label: string) {
  const key = PrivateKey.generateECDSA();
  const tx = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(key)
    .setInitialBalance(new Hbar(0))
    .setMaxAutomaticTokenAssociations(-1)
    .setAccountMemo(`Leash ${label}`)
    .execute(client);
  const r = await tx.getReceipt(client);
  const id = r.accountId!.toString();
  console.log(`  ✓ ${label} account ${id}  ${hashscan.account(id)}`);
  return { accountId: id, privateKey: key.toStringRaw() };
}

function setEnv(k: string, v: string) {
  const p = `${ROOT}.env`;
  const lines = readFileSync(p, "utf8").split("\n");
  const i = lines.findIndex((l) => l.startsWith(`${k}=`));
  if (i >= 0) lines[i] = `${k}=${v}`;
  else lines.push(`${k}=${v}`);
  writeFileSync(p, lines.join("\n"));
}

let state = loadHederaState();
// --new-topic: create the audit topic again under the CURRENT operator (needed after rotating operator
// credentials: an HCS topic only accepts messages signed by its submit key)
if (state && process.argv.includes("--new-topic")) {
  const topicId = await createAuditTopic(opId, opKey);
  setEnv("HCS_TOPIC_ID", topicId);
  state = { ...state, topicId };
  writeFileSync(HEDERA_STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`  ✓ new HCS audit topic ${topicId} (operator ${opId})  ${hashscan.topic(topicId)}`);
}
if (!state) {
  console.log("creating Hedera demo state…");
  let topicId = process.env.HCS_TOPIC_ID;
  if (!topicId || topicId.includes("placeholder")) {
    topicId = await createAuditTopic(opId, opKey);
    setEnv("HCS_TOPIC_ID", topicId);
    console.log(`  ✓ HCS audit topic ${topicId}  ${hashscan.topic(topicId)}`);
  }
  const agent = await newAccount("agent (payer)");
  const merchant = await newAccount("merchant (payTo)");
  state = {
    topicId,
    agent,
    merchant,
  } satisfies HederaDemoState;
  writeFileSync(HEDERA_STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`  saved ${HEDERA_STATE} (gitignored)`);
} else {
  console.log(`using existing ${HEDERA_STATE}: agent ${state.agent.accountId}, merchant ${state.merchant.accountId}, topic ${state.topicId}`);
}

if (fundUsdc > 0n) {
  const tx = await new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(USDC), AccountId.fromString(opId), -Number(fundUsdc))
    .addTokenTransfer(TokenId.fromString(USDC), AccountId.fromString(state.agent.accountId), Number(fundUsdc))
    .execute(client);
  const r = await tx.getReceipt(client);
  console.log(`  ✓ funded agent with ${Number(fundUsdc) / 1e6} USDC (${r.status.toString()})  ${hashscan.tx(tx.transactionId.toString())}`);
}
if (fundHbar > 0) {
  // payment money only — the agent still never pays a network fee (the facilitator is the fee payer)
  const tx = await new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(opId), new Hbar(-fundHbar))
    .addHbarTransfer(AccountId.fromString(state.agent.accountId), new Hbar(fundHbar))
    .execute(client);
  const r = await tx.getReceipt(client);
  console.log(`  ✓ funded agent with ${fundHbar} HBAR (${r.status.toString()})  ${hashscan.tx(tx.transactionId.toString())}`);
}
client.close();
