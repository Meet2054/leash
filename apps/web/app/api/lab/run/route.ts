import { prepareLab, recycle, runSide, type LabEvent, type LabInvoice } from "@/lib/server/lab";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const g = globalThis as unknown as { __labBusy?: boolean; __labLast?: Map<string, number> };
g.__labLast ??= new Map();

/**
 * Runs the same AI on the same task, first without Leash, then with Leash, streaming each step as JSON lines.
 * One run at a time (the "without" side shares one test wallet). A visitor's API key is used for this run only.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { provider?: string; baseUrl?: string; apiKey?: string; model?: string; sides?: ("without" | "with")[] };
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "local";
  const last = g.__labLast!.get(ip) ?? 0;
  if (Date.now() - last < 15_000) return new Response(JSON.stringify({ error: "Please wait a few seconds between runs." }), { status: 429 });
  if (g.__labBusy) return new Response(JSON.stringify({ error: "Someone else is running the lab right now. Try again in a minute." }), { status: 409 });
  const local = b.provider !== "custom";
  const choice = {
    baseUrl: local ? "http://127.0.0.1:11434/v1" : String(b.baseUrl ?? ""),
    apiKey: local ? "ollama" : String(b.apiKey ?? ""),
    model: String(b.model ?? (local ? "qwen3.5:4b" : "")),
  };
  if (!local && (!/^https:\/\//.test(choice.baseUrl) || !choice.apiKey || !choice.model)) return new Response(JSON.stringify({ error: "Enter the service URL (https://…), your API key and a model name." }), { status: 400 });
  const sides = b.sides?.length ? b.sides : (["without", "with"] as const);
  g.__labBusy = true;
  g.__labLast!.set(ip, Date.now());
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: LabEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        let invoices: LabInvoice[] = [];
        try {
          invoices = await prepareLab(emit);
        } catch (e) {
          emit({ type: "error", text: `Couldn't set up the inbox: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }
        for (const side of sides) {
          try {
            await runSide(side, choice, emit, invoices);
          } catch (e) {
            emit({ type: "error", side, text: e instanceof Error ? e.message : String(e) });
          }
        }
        const back = await recycle().catch(() => null);
        if (back) emit({ type: "say", side: "without", text: `(Lab reset: the attacker's ${back} test USDT was moved back so the next visitor can run it.)` });
      } finally {
        g.__labBusy = false;
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
