import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { Address } from "viem";

/**
 * Supplier invoices as x402 payment links. A supplier issues an invoice; it gets a URL that answers HTTP 402
 * with the invoice's exact amount and the supplier's own address as payTo. Any x402 client (an AI
 * accounts-payable agent on Leash, here) pays it in one request. Paying twice is impossible: a paid invoice
 * answers 200 "already paid" before any payment is asked for.
 */
export type SupplierKey = "quote" | "translate" | "summarize";

/** The three businesses this demo merchant platform hosts (each one is a separate payTo address). */
export const SUPPLIERS: Record<SupplierKey, { name: string; what: string }> = {
  quote: { name: "Konkan Cloud Hosting", what: "servers and bandwidth" },
  translate: { name: "Dadar Office Supplies", what: "paper, ink and stationery" },
  summarize: { name: "Bandra Design Studio", what: "design retainer" },
};

export type Invoice = {
  id: string;
  supplierKey: SupplierKey;
  supplier: string;
  payTo: Address;
  /** atomic units, 6 decimals */
  amount: string;
  memo: string;
  /** language of the invoice text, e.g. "en", "mr" */
  lang: string;
  text: string;
  dueDate: string;
  createdAt: string;
  paid?: { at: string; channelId?: string; cumulative?: string; payer?: string };
};

export class InvoiceBook {
  private items = new Map<string, Invoice>();
  constructor(private readonly file?: string) {
    if (file && existsSync(file)) for (const i of JSON.parse(readFileSync(file, "utf8")) as Invoice[]) this.items.set(i.id, i);
  }

  create(input: { supplierKey: SupplierKey; payTo: Address; amount: bigint; memo: string; lang?: string; text?: string; dueDate?: string }): Invoice {
    if (input.amount <= 0n) throw new Error("amount must be positive");
    const id = `INV-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const inv: Invoice = {
      id,
      supplierKey: input.supplierKey,
      supplier: SUPPLIERS[input.supplierKey].name,
      payTo: input.payTo,
      amount: input.amount.toString(),
      memo: input.memo.slice(0, 200),
      lang: input.lang ?? "en",
      text: (input.text ?? input.memo).slice(0, 1000),
      dueDate: input.dueDate ?? new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    this.items.set(id, inv);
    this.save();
    return inv;
  }

  get(id: string): Invoice | undefined {
    return this.items.get(id);
  }

  list(): Invoice[] {
    return [...this.items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markPaid(id: string, info: NonNullable<Invoice["paid"]>) {
    const inv = this.items.get(id);
    if (!inv || inv.paid) return;
    inv.paid = info;
    this.save();
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.list(), null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }
}

/** "/invoices/INV-…" → "INV-…" */
export const invoiceIdOf = (path: string): string | undefined => path.match(/^\/invoices\/([A-Za-z0-9-]{4,40})\/?$/)?.[1];
