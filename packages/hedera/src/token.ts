/**
 * Our own test stablecoin on Hedera testnet (HTS fungible token, 6 decimals like USDC).
 * Mentors confirmed a self-issued test token is fine because the Circle faucet isn't paying out.
 * It is NOT Circle USDC, and the README labels it so.
 *   pnpm hedera:token            create it once (treasury + supply key = operator) and write HEDERA_USDC_TOKEN_ID
 *   pnpm hedera:token --fund 100 also send 100 tUSDC to the demo agent (auto-association is on)
 * Only public ids go into .env; keys stay where they are (.env / keys/, gitignored).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { AccountId, TokenCreateTransaction, TokenId, TokenSupplyType, TokenType, TransferTransaction } from "@hiero-ledger/sdk";
import { ROOT, loadHederaState } from "./config";
import { hashscan, operatorClient, parseHederaKey } from "./hcs";
import { HEDERA_USDC_TESTNET } from "./facilitator";

const opId = process.env.HEDERA_OPERATOR_ID;
const opKey = process.env.HEDERA_OPERATOR_KEY;
if (!opId || !opKey || opKey.includes("placeholder")) throw new Error("set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env");
const client = operatorClient(opId, opKey);
const fund = process.argv.includes("--fund") ? Number(process.argv[process.argv.indexOf("--fund") + 1] ?? "100") : 0;

function setEnv(k: string, v: string) {
  const p = `${ROOT}.env`;
  const lines = readFileSync(p, "utf8").split("\n");
  const i = lines.findIndex((l) => l.startsWith(`${k}=`));
  if (i >= 0) lines[i] = `${k}=${v}`;
  else lines.push(`${k}=${v}`);
  writeFileSync(p, lines.join("\n"));
}

let tokenId = process.env.HEDERA_USDC_TOKEN_ID;
if (!tokenId || tokenId === HEDERA_USDC_TESTNET || process.argv.includes("--new")) {
  const pub = parseHederaKey(opKey).publicKey;
  const tx = await new TokenCreateTransaction()
    .setTokenName("Leash Test USD Coin")
    .setTokenSymbol("tUSDC")
    .setDecimals(6)
    .setInitialSupply(1_000_000_000_000) // 1,000,000.000000 tUSDC
    .setTokenType(TokenType.FungibleCommon)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(AccountId.fromString(opId))
    .setAdminKey(pub)
    .setSupplyKey(pub)
    .setTokenMemo("Leash hackathon test stablecoin (self-issued, not Circle USDC)")
    .execute(client);
  const r = await tx.getReceipt(client);
  tokenId = r.tokenId!.toString();
  setEnv("HEDERA_USDC_TOKEN_ID", tokenId);
  setEnv("HEDERA_USDC_ADDRESS", `0x${TokenId.fromString(tokenId).toEvmAddress().replace(/^0x/, "")}`);
  console.log(`✓ created tUSDC ${tokenId} (${r.status.toString()})  ${hashscan.tx(tx.transactionId.toString())}`);
  console.log(`  token page https://hashscan.io/testnet/token/${tokenId}  · .env HEDERA_USDC_TOKEN_ID updated`);
} else {
  console.log(`using tUSDC ${tokenId} from .env`);
}

if (fund > 0) {
  const st = loadHederaState();
  if (!st) throw new Error("run pnpm hedera:bootstrap first");
  const atomic = Math.round(fund * 1e6);
  const tx = await new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(opId), -atomic)
    .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(st.agent.accountId), atomic)
    .execute(client);
  const r = await tx.getReceipt(client);
  console.log(`✓ sent ${fund} tUSDC to agent ${st.agent.accountId} (${r.status.toString()})  ${hashscan.tx(tx.transactionId.toString())}`);
  // AccountBalanceQuery is deprecated in @hiero-ledger/sdk 2.90: read the mirror node (a few seconds behind)
  await new Promise((res) => setTimeout(res, 6000));
  const j = (await (await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${st.agent.accountId}/tokens?token.id=${tokenId}`)).json()) as { tokens?: { balance: number }[] };
  console.log(`  agent tUSDC balance (mirror node): ${(j.tokens?.[0]?.balance ?? 0) / 1e6}`);
}
client.close();
