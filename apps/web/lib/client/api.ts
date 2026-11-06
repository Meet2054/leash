"use client";
import { useEffect, useRef, useState } from "react";

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const text = await r.text();
  const j = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(j.error ? `${j.error}${j.message ? `: ${j.message}` : ""}` : `HTTP ${r.status}`);
  return j as T;
}

/** Poll a GET endpoint. */
export function usePoll<T>(path: string | null, ms = 3000): { data: T | undefined; error?: string; refresh: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!path) return;
    let t: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const d = await api<T>(path);
        if (alive.current) (setData(d), setError(undefined));
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
      }
      t = setTimeout(run, ms);
    };
    run();
    return () => {
      alive.current = false;
      clearTimeout(t);
    };
  }, [path, ms, tick]);
  return { data, error, refresh: () => setTick((x) => x + 1) };
}

export const short = (s?: string | null, n = 6) => (s ? `${s.slice(0, n + 2)}…${s.slice(-4)}` : "");
export const usdt = (atomic: string | number | bigint | undefined) => {
  if (atomic === undefined) return "–";
  const v = BigInt(atomic);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""}`;
};
export const explorerTx = (h: string) => `https://explorer.testnet.whitechain.io/tx/${h}`;
export const explorerAddr = (a: string) => `https://explorer.testnet.whitechain.io/address/${a}`;

/** Friendly money: 2 decimals (more only for sub-cent amounts). */
export const money = (atomic: string | number | bigint | undefined) => {
  if (atomic === undefined) return "–";
  const v = Number(BigInt(atomic)) / 1e6;
  return v !== 0 && Math.abs(v) < 0.01 ? v.toFixed(4) : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Plain-language version of an attestor policy refusal (F8.1 R1/R2). */
export function friendlyPolicy(reason: string): string {
  const usd = (a: string) => `${(Number(a) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`;
  const r1 = reason.match(/R1: \w+ for \S+ may at most ([\d.]+)× its value 24 h ago \((\d+) → max (\d+), asked (\d+)\)/);
  if (r1) return `Blocked by the safety policy: a limit can grow at most ${r1[1]}× in 24 hours. It was ${usd(r1[2])}, so the most allowed now is ${usd(r1[3])}, and the agent asked for ${usd(r1[4])}. Nothing was signed.`;
  const r2 = reason.match(/R2: daily loosening ceiling (\d+) exceeded \(used (\d+) in 24 h \+ asked (\d+)\)/);
  if (r2) return `Blocked by the safety policy: at most ${usd(r2[1])} of new spending room per day (${usd(r2[2])} already used, ${usd(r2[3])} asked). Nothing was signed.`;
  return reason.replace(/^(blocked by )?attestor policy: /i, "Blocked by the safety policy: ");
}
