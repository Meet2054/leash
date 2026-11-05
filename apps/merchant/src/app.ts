import { Hono } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Address } from "viem";
import { KNOWN_ASSETS, LEASH_SCHEME, LeashSchemeServer, registerAsset } from "@leash/sdk";
import { ExactHederaScheme as ExactHederaServer } from "@x402/hedera/exact/server";

export type MerchantConfig = {
  facilitatorUrl: string;
  publicUrl: string;
  network: `${string}:${string}`;
  payTo: { quote: Address; translate: Address; summarize: Address };
  /** override the network's default stablecoin (local devnets) */
  asset?: { asset: Address; decimals: number; symbol: string };
  /** optional Hedera endpoints: x402 `exact`, settled in HTS USDC on hedera:testnet through our facilitator */
  hedera?: { payTo: string };
};

/** Hedera-paid endpoints. /hedera/report is deliberately above the agent's approval threshold. */
export function hederaCatalog(cfg: MerchantConfig) {
  if (!cfg.hedera) return [];
  return [
    { path: "/hedera/quote", method: "GET", price: "$0.01", payTo: cfg.hedera.payTo, description: "FX quote, paid in USDC on Hedera" },
    { path: "/hedera/translate", method: "GET", price: "$0.02", payTo: cfg.hedera.payTo, description: "Translate a phrase, paid in USDC on Hedera" },
    { path: "/hedera/report", method: "GET", price: "$0.60", payTo: cfg.hedera.payTo, description: "Premium market report (above the agent's auto-approve threshold)" },
  ] as const;
}

/** The three paid endpoints (prices in USD-pegged stablecoin). */
export function catalog(cfg: MerchantConfig) {
  return [
    { path: "/quote", method: "GET", price: "$0.01", payTo: cfg.payTo.quote, name: "FX quote", description: "Live-ish FX quote for a currency pair, e.g. /quote?pair=USD/INR" },
    { path: "/translate", method: "GET", price: "$0.02", payTo: cfg.payTo.translate, name: "Translate", description: "Translate a short phrase, e.g. /translate?text=hello&to=hi" },
    { path: "/summarize", method: "GET", price: "$0.05", payTo: cfg.payTo.summarize, name: "Summarize", description: "Summarize a text, e.g. /summarize?text=..." },
  ] as const;
}

const RATES: Record<string, number> = { "USD/INR": 84.21, "EUR/USD": 1.083, "USD/JPY": 151.4, "GBP/USD": 1.27, "USDT/INR": 84.1 };
const DICT: Record<string, Record<string, string>> = {
  hi: { hello: "नमस्ते", thanks: "धन्यवाद", payment: "भुगतान", agent: "एजेंट" },
  es: { hello: "hola", thanks: "gracias", payment: "pago", agent: "agente" },
  fr: { hello: "bonjour", thanks: "merci", payment: "paiement", agent: "agent" },
};

export function createMerchantApp(cfg: MerchantConfig) {
  if (cfg.asset) registerAsset(cfg.network, cfg.asset);
  const items = catalog(cfg);
  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: cfg.facilitatorUrl })).register(
    cfg.network,
    new LeashSchemeServer(),
  );
  const hItems = hederaCatalog(cfg);
  if (hItems.length) resourceServer.register("hedera:testnet", new ExactHederaServer());
  const routes = Object.fromEntries(
    items.map((i) => [
      `${i.method} ${i.path}`,
      {
        accepts: { scheme: LEASH_SCHEME, price: i.price, network: cfg.network, payTo: i.payTo, maxTimeoutSeconds: 120 },
        description: i.description,
        mimeType: "application/json",
        serviceName: "Leash demo merchant",
      },
    ]),
  );
  for (const h of hItems) {
    (routes as Record<string, unknown>)[`${h.method} ${h.path}`] = {
      accepts: { scheme: "exact", price: h.price, network: "hedera:testnet", payTo: h.payTo, maxTimeoutSeconds: 120 },
      description: h.description,
      mimeType: "application/json",
      serviceName: "Leash demo merchant (Hedera)",
    };
  }

  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["PAYMENT-SIGNATURE", "Content-Type", "Access-Control-Expose-Headers"],
      exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"],
    }),
  );

  // Discovery (IETF draft-hawkins-x402-dns-discovery-03 manifest shape; non-normative)
  app.get("/.well-known/x402", (c) =>
    c.json({
      x402Version: 2,
      kind: "resource-server",
      name: "Leash demo merchant",
      description: "Three pay-per-call APIs settled in USDT through Leash batched channels.",
      resources: items.map((i) => ({ url: `${cfg.publicUrl}${i.path}`, method: i.method, description: i.description, price: i.price, scheme: LEASH_SCHEME, network: cfg.network, payTo: i.payTo })),
      facilitator: { baseUrl: cfg.facilitatorUrl, endpoints: { supported: "/supported", verify: "/verify", settle: "/settle" } },
      updated: new Date().toISOString(),
    }),
  );
  app.get("/health", (c) => c.json({ ok: true }));

  app.use(paymentMiddleware(routes, resourceServer));

  app.get("/quote", (c) => {
    const pair = (c.req.query("pair") ?? "USD/INR").toUpperCase();
    const base = RATES[pair] ?? 1;
    const jitter = 1 + (Math.sin(Date.now() / 60_000) * 0.002);
    return c.json({ pair, rate: Number((base * jitter).toFixed(4)), at: new Date().toISOString() });
  });

  app.get("/translate", (c) => {
    const text = (c.req.query("text") ?? "hello").toLowerCase();
    const to = c.req.query("to") ?? "hi";
    const out = text
      .split(/\s+/)
      .map((w) => DICT[to]?.[w] ?? w)
      .join(" ");
    return c.json({ text, to, translation: out });
  });

  app.get("/summarize", (c) => {
    const text = c.req.query("text") ?? "";
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const words = text.split(/\s+/).filter(Boolean).length;
    return c.json({ summary: sentences[0]?.slice(0, 200) ?? "", sentences: sentences.length, words });
  });

  app.get("/hedera/quote", (c) => c.json({ pair: (c.req.query("pair") ?? "USD/INR").toUpperCase(), rate: RATES[(c.req.query("pair") ?? "USD/INR").toUpperCase()] ?? 1, settledOn: "hedera:testnet", at: new Date().toISOString() }));
  app.get("/hedera/translate", (c) => {
    const text = (c.req.query("text") ?? "hello").toLowerCase();
    const to = c.req.query("to") ?? "hi";
    return c.json({ text, to, translation: text.split(/\s+/).map((w) => DICT[to]?.[w] ?? w).join(" "), settledOn: "hedera:testnet" });
  });
  app.get("/hedera/report", (c) => c.json({ report: "USD/INR steady; agent payments volume up 12% WoW (demo data)", settledOn: "hedera:testnet" }));

  return { app, items: [...items, ...hItems] };
}

/** Publish our resources to the facilitator's discovery list so agents can find them. */
export async function registerWithFacilitator(cfg: MerchantConfig, f: typeof fetch = fetch) {
  const supported = (await (await f(`${cfg.facilitatorUrl}/supported`)).json()) as { kinds: { scheme: string; network: string; extra?: Record<string, unknown> }[] };
  const kind = supported.kinds.find((k) => k.scheme === LEASH_SCHEME && k.network === cfg.network);
  if (!kind) throw new Error(`facilitator does not support ${LEASH_SCHEME} on ${cfg.network}`);
  const server = new LeashSchemeServer();
  type DiscoveryItem = { resource: { url: string; description: string; mimeType: string }; method: string; accepts: Record<string, unknown>[] };
  const resources: DiscoveryItem[] = await Promise.all(
    catalog(cfg).map(async (i) => {
      const { amount, asset } = await server.parsePrice(i.price, cfg.network);
      return {
        resource: { url: `${cfg.publicUrl}${i.path}`, description: i.description, mimeType: "application/json" },
        method: i.method,
        accepts: [
          { scheme: LEASH_SCHEME, network: cfg.network, asset, amount, payTo: i.payTo, maxTimeoutSeconds: 120, extra: kind.extra ?? {} },
        ],
      };
    }),
  );
  const hKind = supported.kinds.find((k) => k.scheme === "exact" && k.network === "hedera:testnet");
  if (cfg.hedera && hKind) {
    const hs = new ExactHederaServer();
    for (const i of hederaCatalog(cfg)) {
      const { amount, asset } = await hs.parsePrice(i.price, "hedera:testnet");
      resources.push({
        resource: { url: `${cfg.publicUrl}${i.path}`, description: i.description, mimeType: "application/json" },
        method: i.method,
        accepts: [{ scheme: "exact", network: "hedera:testnet", asset, amount, payTo: i.payTo, maxTimeoutSeconds: 120, extra: hKind.extra ?? {} }],
      });
    }
  }
  const res = await f(`${cfg.facilitatorUrl}/discovery/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resources }),
  });
  if (!res.ok) throw new Error(`discovery register failed: ${res.status}`);
  return resources;
}

export { KNOWN_ASSETS };
