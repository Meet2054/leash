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
