import { spawn } from "node:child_process";
import { join } from "node:path";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ROOT = process.env.LEASH_ROOT ?? join(process.cwd(), "..", "..");
const AGENT_DIR = join(ROOT, "apps", "agent");
const g = globalThis as unknown as { __apBusy?: boolean; __apLast?: number; __apIp?: Map<string, number> };
g.__apIp ??= new Map();

type Tone = "head" | "good" | "bad" | "warn" | "info" | "muted" | "plain";
const toneOf = (raw: string): Tone => {
  if (raw.includes("\x1b[1m")) return "head";
  if (raw.includes("\x1b[32m")) return "good";
  if (raw.includes("\x1b[31m")) return "bad";
  if (raw.includes("\x1b[33m")) return "warn";
  if (raw.includes("\x1b[36m")) return "info";
  if (raw.includes("\x1b[2m")) return "muted";
  return "plain";
};
// eslint-disable-next-line no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/**
 * Runs the scripted accounts-payable job (apps/agent `ap`) on the live testnets and streams its steps.
 * Real money moves (test USDT / tUSDC from our own demo vault), so: one run at a time, and a pause between runs.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "local";
  if (g.__apBusy) return Response.json({ error: "A run is in progress right now. Watch it finish, then try again." }, { status: 409 });
  if (Date.now() - (g.__apLast ?? 0) < 45_000) return Response.json({ error: "The last run just finished. Give it 45 seconds so the batch settles, then run it again." }, { status: 429 });
  if (Date.now() - (g.__apIp!.get(ip) ?? 0) < 120_000) return Response.json({ error: "You ran it a moment ago. Try again in two minutes." }, { status: 429 });
  g.__apBusy = true;
  g.__apIp!.set(ip, Date.now());
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const p = spawn(join(AGENT_DIR, "node_modules", ".bin", "tsx"), ["--env-file=../../.env", "src/agent.ts", "ap"], { cwd: AGENT_DIR, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      const kill = setTimeout(() => p.kill("SIGTERM"), 240_000);
      let buf = "";
      let err = "";
      p.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) if (strip(l).trim()) send({ tone: toneOf(l), text: strip(l) });
      });
      p.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-600)));
      p.on("close", (code) => {
        clearTimeout(kill);
        if (buf.trim()) send({ tone: toneOf(buf), text: strip(buf) });
        send(code === 0 ? { done: true } : { error: `The run stopped early. ${strip(err).split("\n").filter(Boolean).pop() ?? ""}`.trim() });
        g.__apBusy = false;
        g.__apLast = Date.now();
        ctrl.close();
      });
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
