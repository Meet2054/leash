/**
 * Demo merchant: 3 x402-paid endpoints settled through the Leash facilitator.
 *   MERCHANT_PORT=4022, MERCHANT_PUBLIC_URL, FACILITATOR_URL=http://localhost:4021, CHAIN=whitechain|local
 *   MERCHANT_QUOTE_PK / MERCHANT_TRANSLATE_PK / MERCHANT_SUMMARIZE_PK (payTo addresses derive from these)
 */
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { fileURLToPath } from "node:url";
import { createMerchantApp, registerWithFacilitator, type MerchantConfig } from "./app.js";
import { InvoiceBook } from "./invoices.js";

const port = Number(process.env.MERCHANT_PORT ?? 4022);
const publicUrl = process.env.MERCHANT_PUBLIC_URL ?? `http://localhost:${port}`;
const facilitatorUrl = process.env.FACILITATOR_URL ?? "http://localhost:4021";
const isLocal = process.env.CHAIN === "local";
const addr = (k: string) => privateKeyToAccount(process.env[k] as Hex).address;

const cfg: MerchantConfig = {
  facilitatorUrl,
  publicUrl,
  network: isLocal ? "eip155:31337" : "eip155:1874",
  payTo: { quote: addr("MERCHANT_QUOTE_PK"), translate: addr("MERCHANT_TRANSLATE_PK"), summarize: addr("MERCHANT_SUMMARIZE_PK") },
  hedera: (() => {
    try {
      const st = JSON.parse(readFileSync(new URL("../../../keys/hedera-demo.json", import.meta.url), "utf8"));
      return { payTo: st.merchant.accountId as string };
    } catch {
      return undefined;
    }
  })(),
  asset: isLocal && process.env.LOCAL_TOKEN ? { asset: process.env.LOCAL_TOKEN as Address, decimals: 6, symbol: "USDT" } : undefined,
  invoices: new InvoiceBook(process.env.MERCHANT_INVOICES_FILE ?? fileURLToPath(new URL(`../../../data/invoices-${isLocal ? 31337 : 1874}.json`, import.meta.url))),
  adminToken: process.env.ADMIN_TOKEN,
};

// the facilitator must list leash-batch on our network before the payment middleware initializes
for (let i = 0; ; i++) {
  try {
    await registerWithFacilitator(cfg);
    break;
  } catch (e) {
    if (i > 60) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const { app, items } = createMerchantApp(cfg);
serve({ fetch: app.fetch, port, hostname: process.env.BIND_HOST ?? "0.0.0.0" }, () => {
  console.log(`[merchant] ${cfg.network} on ${publicUrl} via ${facilitatorUrl}`);
  for (const i of items) console.log(`  ${i.method} ${i.path}  ${"label" in i ? i.label : i.price}  → ${i.payTo}`);
});
