"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/leash/kit";
import { cn } from "@/lib/utils";

type Line = { tone: "head" | "good" | "bad" | "warn" | "info" | "muted" | "plain"; text: string };

const TONE: Record<Line["tone"], string> = {
  head: "pt-3 font-semibold text-foreground",
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-red-700 dark:text-red-400",
  warn: "text-amber-700 dark:text-amber-400",
  info: "text-foreground",
  muted: "text-muted-foreground",
  plain: "text-foreground",
};

function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)”"]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all underline underline-offset-2">
            {p.replace(/^https:\/\/(explorer\.testnet\.whitechain\.io|hashscan\.io\/testnet|merchant\.permissionless\.in)/, (m) => (m.includes("whitechain") ? "Whitechain explorer" : m.includes("hashscan") ? "HashScan" : "merchant"))}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const PROOF: [string, string][] = [
  ["Konkan Cloud Hosting paid 0.40 USDT, settled on Whitechain", "https://explorer.testnet.whitechain.io/tx/0x920385e51a58b908342ddc746a0e86078c7a17d0ce536ac3063e0f80d6e12995"],
  ["Dadar Office Supplies paid 0.25 USDT, settled on Whitechain", "https://explorer.testnet.whitechain.io/tx/0xfed487189901abfe8f3c748f4a050e1217db9954c5d76428624438940aedcace"],
  ["Marathi invoice translated by AI, paid per call on Hedera", "https://hashscan.io/testnet/transaction/0.0.11329302@1793993125.878983165"],
  ["Every decision on the Hedera audit log (HCS)", "https://hashscan.io/testnet/topic/0.0.11329753"],
  ["The suppliers' invoice book", "https://merchant.permissionless.in/invoices"],
];

export default function UseCase() {
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  async function run() {
    setLines([]);
    setNote(null);
    setRunning(true);
    try {
      const r = await fetch("/api/usecase/run", { method: "POST" });
      if (!r.ok || !r.body) {
        setNote(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          if (!p.trim()) continue;
          const o = JSON.parse(p) as Line & { done?: boolean; error?: string };
          if (o.error) setNote(o.error);
          else if (!o.done) setLines((l) => [...l, o]);
          requestAnimationFrame(() => end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
        }
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-3xl space-y-4 px-4 pb-16 pt-[max(env(safe-area-inset-top),16px)]">
      <Link href="/" className="inline-flex items-center gap-1 text-[0.8rem] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Leash
      </Link>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">A real job: accounts payable</h1>
        <p className="text-[0.9rem] leading-relaxed text-muted-foreground">
          A Mumbai business lets an AI agent pay its supplier invoices. One invoice is in Marathi. One email is a scam. The agent does the whole job by itself, on two chains, with real test money.
        </p>
      </div>

      <Section title="What happens when you press Run">
        <ol className="list-decimal space-y-1.5 pl-5 text-[0.86rem] leading-relaxed">
          <li>
            Two suppliers send invoices as <b>payment links</b>: Konkan Cloud Hosting (0.40 USDT) and Dadar Office Supplies (0.25 USDT, written in Marathi).
          </li>
          <li>
            The agent can&apos;t read Marathi, so it <b>buys an AI translation on Hedera</b>. It finds two translation services, picks the cheaper one, and pays per call in tUSDC. It never pays a network fee.
          </li>
          <li>
            It checks the amount on the invoice against the payment link, then <b>pays both suppliers in USDT on Whitechain</b> from its Leash vault. The agent holds no gas and no seed phrase.
          </li>
          <li>
            A fake &ldquo;our bank details changed&rdquo; email asks for 3 USDT to a new address. The agent tries, and <b>the vault contract refuses</b>: that address isn&apos;t one of the owner&apos;s suppliers.
          </li>
          <li>
            The relayer settles the payments onchain, and each supplier&apos;s receipt shows the USDT that arrived.
          </li>
        </ol>
        <Button className="h-11 w-full gap-2 sm:w-auto" disabled={running} onClick={run}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {running ? "Running on Whitechain and Hedera…" : "Run the accounts-payable job"}
        </Button>
        <p className="text-[0.78rem] text-muted-foreground">Takes about a minute. Real test transactions; one run at a time.</p>
        {note && <div className="well p-3 text-[0.84rem]">{note}</div>}
      </Section>

      {(lines.length > 0 || running) && (
        <Section title="Live run">
          <div className="well space-y-1 overflow-hidden p-3.5 font-mono text-[0.74rem] leading-relaxed">
            {lines.map((l, i) => (
              <div key={i} className={cn("whitespace-pre-wrap break-words", TONE[l.tone])}>
                <Linked text={l.text} />
              </div>
            ))}
            {running && <div className="animate-pulse text-muted-foreground">…</div>}
            <div ref={end} />
          </div>
        </Section>
      )}

      <Section title="Proof from an earlier run" description="Click any line to see it on the block explorer.">
        <ul className="space-y-1.5 text-[0.84rem]">
          {PROOF.map(([label, href]) => (
            <li key={href}>
              <a className="underline underline-offset-4" href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Why each chain">
        <ul className="list-disc space-y-1.5 pl-5 text-[0.84rem] leading-relaxed text-muted-foreground">
          <li>
            <b className="text-foreground">Whitechain</b> holds the money and the rules. The vault only pays suppliers the owner allowed, up to the cap. Hundreds of small payments settle in one USDT claim, and the agent never pays gas.
          </li>
          <li>
            <b className="text-foreground">Hedera</b> is where the agent buys services per call: fixed tiny fees paid by our facilitator, fast finality, and a public audit log of every spend.
          </li>
          <li>
            <b className="text-foreground">World ID</b> guards the one thing the agent can&apos;t do: add a new supplier or raise its limit. That needs the owner, in person.
          </li>
        </ul>
      </Section>
    </div>
  );
}
