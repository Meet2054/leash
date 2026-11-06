"use client";
import { ShieldAlert, ShieldCheck } from "lucide-react";

/** F8.2: the attestor's decoding next to this device's decoding of the bytes it will sign. Mismatch = block. */
export function decodingsMatch(a: string[] | null | undefined, b: string[] | null | undefined) {
  return Boolean(a && b && a.length === b.length && a.every((l, i) => l === b[i]));
}

/** Plain-language view of a canonical op line (the raw line stays visible underneath). */
function humanize(line: string): string {
  const usd = (s: string) => s.match(/\(([\d.]+) USDT\)/)?.[1]?.replace(/\.?0+$/, "") ?? "";
  if (line.startsWith("SET_SESSION_LIMITS")) {
    const iso = line.match(/expiry \d+ \(([^)]+)\)/)?.[1];
    const until = iso && iso !== "never" ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null;
    return `Set the agent's spending cap to ${usd(line.split("cap ")[1] ?? "")} USDT${until ? `, valid until ${until}` : ""}`;
  }
  if (line.startsWith("ADD_SESSION")) return `Add an agent with a ${usd(line.split("cap ")[1] ?? "")} USDT cap`;
  if (line.startsWith("WITHDRAW")) return `Withdraw ${usd(line)} USDT to ${line.split("to ")[1]?.slice(0, 10)}…`;
  if (line.startsWith("SET_MERCHANT")) return `Allow merchant ${line.split("merchant ")[1]?.slice(0, 10)}… (daily ${usd(line.split("dailyCap ")[1] ?? "")} USDT)`;
  if (line.startsWith("REVOKE_SESSION")) return "Revoke an agent session";
  if (line.startsWith("REMOVE_MERCHANT")) return "Remove a merchant";
  if (line.startsWith("ROTATE_PQ_KEY")) return "Replace your owner key";
  if (line.startsWith("SET_VERIFIER")) return "Change the signature verifier";
  return line;
}

export function DecodePanel({ server, local }: { server: string[] | null | undefined; local: string[] | null | undefined }) {
  const ok = decodingsMatch(server, local);
  const ops = (local ?? []).slice(1);
  return (
    <div className="well space-y-3 p-4">
      <div className="flex items-center gap-2">
        {ok ? <ShieldCheck className="size-4 text-[var(--ok)]" /> : <ShieldAlert className="size-4 text-[var(--bad)]" />}
        <div className="text-[0.85rem] font-medium">{ok ? "Checked twice: this is exactly what you'll sign" : "Mismatch: signing is blocked"}</div>
      </div>
      <ul className="space-y-1">
        {ops.map((l, i) => (
          <li key={i} className="text-[0.95rem] font-medium">
            {humanize(l)}
          </li>
        ))}
      </ul>
      <details className="group">
        <summary className="cursor-pointer text-[0.75rem] text-muted-foreground hover:text-foreground">Show both decodings (server vs this device)</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {[
            ["Attestor (server)", server, local],
            ["This device (bytes it signs)", local, server],
          ].map(([title, lines, other]) => (
            <div key={title as string} className="min-w-0 space-y-1">
              <div className="text-[0.7rem] font-medium text-muted-foreground">{title as string}</div>
              {((lines as string[] | null) ?? ["(missing)"]).map((l, i) => (
                <div key={i} className="break-all font-mono text-[0.68rem] leading-snug" style={(other as string[] | null) && (other as string[])[i] !== l ? { color: "var(--bad)" } : undefined}>
                  {l}
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
