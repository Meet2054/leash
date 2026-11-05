/** Atomic (6-decimal) stablecoin amounts <-> display strings. */
export function formatUnits6(atomic: bigint | string | number, decimals = 6): string {
  const v = BigInt(atomic);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export function parseUnits6(display: string, decimals = 6): bigint {
  const s = display.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`bad amount: ${display}`);
  const [w, f = ""] = s.split(".");
  if (f.length > decimals) throw new Error(`too many decimals: ${display}`);
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0");
}

export const jsonBigint = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
