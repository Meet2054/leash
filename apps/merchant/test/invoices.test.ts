import { describe, expect, it } from "vitest";
import { createMerchantApp, type MerchantConfig } from "../src/app.js";
import { InvoiceBook, invoiceIdOf } from "../src/invoices.js";

const cfg = (book: InvoiceBook): MerchantConfig => ({
  facilitatorUrl: "http://127.0.0.1:9", // never reached by these routes
  publicUrl: "https://merchant.example",
  network: "eip155:1874",
  payTo: { quote: "0x3425bC52cd7f10F1221eF2708321b4b0924d431D", translate: "0xE1f69E258c7dEb96E9BfC6534e5fd55211D3f336", summarize: "0x45D40fA17ee8B986553bF11b96130E58Ad71a6Ce" },
  invoices: book,
  adminToken: "test-token",
});
const post = (body: unknown, token?: string) =>
  new Request("http://x/invoices", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

describe("supplier invoices (x402 payment links)", () => {
  it("only the supplier platform can issue invoices", async () => {
    const { app } = createMerchantApp(cfg(new InvoiceBook()));
    expect((await app.fetch(post({ supplier: "quote", amountUsdt: "0.4" }))).status).toBe(401);
    expect((await app.fetch(post({ supplier: "quote", amountUsdt: "0.4" }, "wrong"))).status).toBe(401);
  });

  it("issues an invoice payable to that supplier's own address, for the exact amount", async () => {
    const { app } = createMerchantApp(cfg(new InvoiceBook()));
    const r = await app.fetch(post({ supplier: "translate", amountUsdt: "0.25", memo: "ink", lang: "mr" }, "test-token"));
    expect(r.status).toBe(201);
    const inv = (await r.json()) as { id: string; payTo: string; amountUsdt: string; status: string; payUrl: string };
    expect(inv.payTo).toBe("0xE1f69E258c7dEb96E9BfC6534e5fd55211D3f336");
    expect(inv.amountUsdt).toBe("0.25");
    expect(inv.status).toBe("open");
    expect(inv.payUrl).toBe(`https://merchant.example/invoices/${inv.id}`);
    expect(invoiceIdOf(new URL(inv.payUrl).pathname)).toBe(inv.id);
  });

  it("rejects unknown suppliers and bad amounts", async () => {
    const { app } = createMerchantApp(cfg(new InvoiceBook()));
    expect((await app.fetch(post({ supplier: "attacker", amountUsdt: "1" }, "test-token"))).status).toBe(400);
    for (const amountUsdt of ["0", "-1", "abc", "1000000"]) expect((await app.fetch(post({ supplier: "quote", amountUsdt }, "test-token"))).status).toBe(400);
  });

  it("an unknown invoice is 404 and a paid one can never be paid again", async () => {
    const book = new InvoiceBook();
    const { app } = createMerchantApp(cfg(book));
    expect((await app.fetch(new Request("http://x/invoices/INV-NOPE-0"))).status).toBe(404);
    const inv = book.create({ supplierKey: "quote", payTo: "0x3425bC52cd7f10F1221eF2708321b4b0924d431D", amount: 400_000n, memo: "hosting" });
    book.markPaid(inv.id, { at: new Date().toISOString(), channelId: "0x01", cumulative: "400000" });
    const again = await app.fetch(new Request(`http://x/invoices/${inv.id}`));
    expect(again.status).toBe(200);
    expect(again.headers.get("PAYMENT-REQUIRED")).toBeNull();
    expect(((await again.json()) as { status: string }).status).toBe("already_paid");
    // marking paid twice keeps the first payment
    book.markPaid(inv.id, { at: "later", channelId: "0x02" });
    expect(book.get(inv.id)?.paid?.channelId).toBe("0x01");
  });

  it("the receipt shows open vs paid", async () => {
    const book = new InvoiceBook();
    const { app } = createMerchantApp(cfg(book));
    const inv = book.create({ supplierKey: "summarize", payTo: "0x45D40fA17ee8B986553bF11b96130E58Ad71a6Ce", amount: 50_000n, memo: "design" });
    const open = (await (await app.fetch(new Request(`http://x/receipts/${inv.id}`))).json()) as { status: string; settlement: string };
    expect(open.status).toBe("open");
    expect(open.settlement).toBe("not paid");
  });
});
