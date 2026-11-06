"use client";

/** F8.2: the attestor's decoding next to this device's decoding of the bytes it will sign. Mismatch = block. */
export function decodingsMatch(a: string[] | null | undefined, b: string[] | null | undefined) {
  return Boolean(a && b && a.length === b.length && a.every((l, i) => l === b[i]));
}

export function DecodePanel({ server, local }: { server: string[] | null | undefined; local: string[] | null | undefined }) {
  const ok = decodingsMatch(server, local);
  const col = (title: string, lines: string[] | null | undefined, other: string[] | null | undefined) => (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="text-xs font-semibold muted">{title}</div>
      {(lines ?? ["(missing)"]).map((l, i) => (
        <div key={i} className="mono text-[11px] break-all leading-snug" style={other && other[i] !== l ? { color: "var(--color-bad)" } : undefined}>
          {l}
        </div>
      ))}
    </div>
  );
  return (
    <div className="soft rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">What you are approving</div>
        <span className="pill" style={{ color: ok ? "var(--color-ok)" : "var(--color-bad)" }}>{ok ? "✓ both decodings match" : "✕ mismatch: signing blocked"}</span>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        {col("Attestor (server) decoded", server, local)}
        {col("This device decoded (the bytes it will sign)", local, server)}
      </div>
    </div>
  );
}
