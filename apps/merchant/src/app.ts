import { Hono } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { formatUnits, getAddress, parseUnits, type Address } from "viem";
import { KNOWN_ASSETS, LEASH_SCHEME, LeashSchemeServer, registerAsset } from "@leash/sdk";
import { ExactHederaScheme as ExactHederaServer } from "@x402/hedera/exact/server";
import { formatHedera, hederaPricing } from "@leash/hedera";
import { InvoiceBook, SUPPLIERS, invoiceIdOf, type Invoice, type SupplierKey } from "./invoices.js";
import { LANGS, aiTranslate, dictTranslate } from "./ai.js";

export type MerchantConfig = {
  facilitatorUrl: string;
  publicUrl: string;
  network: `${string}:${string}`;
  payTo: { quote: Address; translate: Address; summarize: Address };
  /** override the network's default stablecoin (local devnets) */
  asset?: { asset: Address; decimals: number; symbol: string };
  /** optional Hedera endpoints: x402 `exact`, settled in HTS USDC on hedera:testnet through our facilitator */
  hedera?: { payTo: string };
  /** supplier invoices (x402 payment links); file-backed in production, in-memory in tests */
  invoices?: InvoiceBook;
  /** protects POST /invoices (only the suppliers issue invoices); unset = open (local dev) */
  adminToken?: string;
};

/** Hedera-paid endpoints. /hedera/report is deliberately above the agent's approval threshold. */
export function hederaCatalog(cfg: MerchantConfig) {
  if (!cfg.hedera) return [];
  const p = hederaPricing();
  const price = (amount: bigint) => ({ asset: p.asset, amount: amount.toString() });
  return [
    { path: "/hedera/quote", method: "GET", price: price(p.prices.quote), label: `${formatHedera(p.prices.quote)} ${p.symbol}`, payTo: cfg.hedera.payTo, description: `FX quote, paid in ${p.symbol} on Hedera` },
    { path: "/hedera/translate", method: "GET", price: price(p.prices.translate), label: `${formatHedera(p.prices.translate)} ${p.symbol}`, payTo: cfg.hedera.payTo, description: `AI translation for business documents (Marathi, Hindi, Gujarati, Tamil… ↔ English), paid per call in ${p.symbol} on Hedera. e.g. ?text=…&to=en` },
    { path: "/hedera/translate-plus", method: "GET", price: price(p.prices.translate * 2n), label: `${formatHedera(p.prices.translate * 2n)} ${p.symbol}`, payTo: cfg.hedera.payTo, description: `AI translation plus a line listing every amount and date found (premium), paid per call in ${p.symbol} on Hedera` },
    { path: "/hedera/report", method: "GET", price: price(p.prices.report), label: `${formatHedera(p.prices.report)} ${p.symbol}`, payTo: cfg.hedera.payTo, description: "Premium market report (above the agent's auto-approve threshold)" },
  ];
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

const publicInvoice = (cfg: MerchantConfig, i: Invoice) => ({
  id: i.id,
  supplier: i.supplier,
  payTo: i.payTo,
  amountUsdt: formatUnits(BigInt(i.amount), 6),
  memo: i.memo,
  lang: i.lang,
  text: i.text,
  dueDate: i.dueDate,
  status: i.paid ? "paid" : "open",
  payUrl: `${cfg.publicUrl}/invoices/${i.id}`,
  receiptUrl: `${cfg.publicUrl}/receipts/${i.id}`,
  paid: i.paid,
});

export function createMerchantApp(cfg: MerchantConfig) {
  if (cfg.asset) registerAsset(cfg.network, cfg.asset);
  const book = cfg.invoices ?? new InvoiceBook();
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
  // Supplier invoices: one x402 route; price and payTo come from the invoice itself.
  const invoiceOf = (path: string) => {
    const id = invoiceIdOf(path);
    return id ? book.get(id) : undefined;
  };
  (routes as Record<string, unknown>)["GET /invoices/*"] = {
    accepts: {
      scheme: LEASH_SCHEME,
      network: cfg.network,
      price: (ctx: { path: string }) => `$${formatUnits(BigInt(invoiceOf(ctx.path)?.amount ?? "10000"), 6)}`,
      payTo: (ctx: { path: string }) => invoiceOf(ctx.path)?.payTo ?? cfg.payTo.quote,
      maxTimeoutSeconds: 120,
    },
    description: "Supplier invoice (x402 payment link): pays the exact invoice amount to the supplier",
    mimeType: "application/json",
    serviceName: "Leash merchant platform: invoices",
  };
  // An invoice counts as paid only after the facilitator accepted the payment (settle), never on the request alone.
  resourceServer.onAfterSettle(async (ctx) => {
    const url = (ctx.paymentPayload.resource as { url?: string } | undefined)?.url;
    const id = url ? invoiceIdOf(new URL(url, cfg.publicUrl).pathname) : undefined;
    if (!id) return;
    const p = ctx.paymentPayload.payload as { channelId?: string; cumulativeAmount?: string; session?: string };
    book.markPaid(id, { at: new Date().toISOString(), channelId: p.channelId, cumulative: p.cumulativeAmount, payer: p.session });
  });
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

  // ---- supplier invoices (free endpoints; paying happens on GET /invoices/:id below)
  app.post("/invoices", async (c) => {
    if (cfg.adminToken && c.req.header("authorization") !== `Bearer ${cfg.adminToken}`) return c.json({ error: "unauthorized" }, 401);
    const b = (await c.req.json().catch(() => ({}))) as { supplier?: string; amountUsdt?: string; memo?: string; lang?: string; text?: string; dueDate?: string };
    const key = b.supplier as SupplierKey;
    if (!SUPPLIERS[key]) return c.json({ error: "unknown_supplier", suppliers: Object.keys(SUPPLIERS) }, 400);
    let amount: bigint;
    try {
      amount = parseUnits(String(b.amountUsdt ?? ""), 6);
    } catch {
      return c.json({ error: "bad_amount" }, 400);
    }
    if (amount <= 0n || amount > 1_000_000_000n) return c.json({ error: "bad_amount" }, 400);
    const inv = book.create({ supplierKey: key, payTo: getAddress(cfg.payTo[key]), amount, memo: String(b.memo ?? "Invoice"), lang: b.lang, text: b.text, dueDate: b.dueDate });
    return c.json(publicInvoice(cfg, inv), 201);
  });
  app.get("/invoices", (c) =>
    c.json({
      suppliers: Object.fromEntries(Object.entries(SUPPLIERS).map(([k, v]) => [k, { ...v, payTo: cfg.payTo[k as SupplierKey] }])),
      invoices: book.list().slice(0, 50).map((i) => publicInvoice(cfg, i)),
    }),
  );
  app.get("/receipts/:id", async (c) => {
    const inv = book.get(c.req.param("id"));
    if (!inv) return c.json({ error: "unknown_invoice" }, 404);
    // the onchain settlement: the facilitator's Claimed event for this invoice's channel (batched, ~90 s)
    let claims: { tx: string; explorerUrl: string; amountUsdt: string }[] = [];
    if (inv.paid?.channelId) {
      try {
        const ev = (await (await fetch(`${cfg.facilitatorUrl}/events?kind=Claimed&limit=500`, { signal: AbortSignal.timeout(3000) })).json()) as { channel_id: string; tx: string; amount: string }[];
        claims = ev
          .filter((e) => e.channel_id?.toLowerCase() === inv.paid!.channelId!.toLowerCase())
          .map((e) => ({ tx: e.tx, explorerUrl: `https://explorer.testnet.whitechain.io/tx/${e.tx}`, amountUsdt: formatUnits(BigInt(e.amount), 6) }));
      } catch {
        /* facilitator unreachable: the receipt still shows the accepted payment */
      }
    }
    return c.json({ ...publicInvoice(cfg, inv), settlement: inv.paid ? (claims.length ? "settled onchain in USDT" : "accepted; the onchain USDT claim lands in the next batch (within ~90 s)") : "not paid", claims });
  });
  // a paid invoice answers before any payment is asked for, so it can never be paid twice
  app.use("/invoices/:id", async (c, next) => {
    if (c.req.method !== "GET") return next();
    const inv = book.get(c.req.param("id"));
    if (!inv) return c.json({ error: "unknown_invoice" }, 404);
    if (inv.paid) return c.json({ status: "already_paid", invoice: publicInvoice(cfg, inv) });
    return next();
  });

  app.use(paymentMiddleware(routes, resourceServer));

  app.get("/invoices/:id", (c) => {
    const inv = book.get(c.req.param("id"))!;
    return c.json({ status: "paid", invoice: { ...publicInvoice(cfg, inv), status: "paid" }, settlement: "Leash batched channel: the USDT claim lands onchain within ~90 s; see receiptUrl" });
  });

  app.get("/quote", (c) => {
    const pair = (c.req.query("pair") ?? "USD/INR").toUpperCase();
    const base = RATES[pair] ?? 1;
    const jitter = 1 + (Math.sin(Date.now() / 60_000) * 0.002);
    return c.json({ pair, rate: Number((base * jitter).toFixed(4)), at: new Date().toISOString() });
  });

  app.get("/translate", (c) => {
    const text = (c.req.query("text") ?? "hello").toLowerCase();
    const to = c.req.query("to") ?? "hi";
    return c.json({ text, to, translation: dictTranslate(text, to) });
  });

  app.get("/summarize", (c) => {
    const text = c.req.query("text") ?? "";
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const words = text.split(/\s+/).filter(Boolean).length;
    return c.json({ summary: sentences[0]?.slice(0, 200) ?? "", sentences: sentences.length, words });
  });

  app.get("/hedera/quote", (c) => c.json({ pair: (c.req.query("pair") ?? "USD/INR").toUpperCase(), rate: RATES[(c.req.query("pair") ?? "USD/INR").toUpperCase()] ?? 1, settledOn: "hedera:testnet", at: new Date().toISOString() }));
  // Real work: an open-weight model translates business documents (regional Indian languages ↔ English).
  for (const [path, careful] of [["/hedera/translate", false], ["/hedera/translate-plus", true]] as const) {
    app.get(path, async (c) => {
      const text = (c.req.query("text") ?? "hello").slice(0, 1500);
      const q = c.req.query("to") ?? "en";
      const to = LANGS[q] ? q : "en";
      const r = await aiTranslate(text, to, { careful });
      return c.json({ text, to: LANGS[to], ...r, settledOn: "hedera:testnet" });
    });
  }
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
