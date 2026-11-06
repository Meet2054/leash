import { short } from "@/lib/client/api";

export const clock = (sec: number) => new Date(sec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const dateTime = (sec: number) => new Date(sec * 1000).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const dayTime = (sec: number) => new Date(sec * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "23h 41m" / "12m" until a unix time (seconds). */
export function until(sec: number): string {
  const s = Math.max(0, Math.floor(sec - Date.now() / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export type Resource = { resource: string; accepts: { payTo: string; network?: string }[] };
/** payTo address → service name ("Quote", "Translate", …) from the facilitator's discovery list. */
export function merchantNames(items: Resource[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of items ?? []) {
    const a = r.accepts?.[0];
    if (!a?.payTo?.startsWith("0x")) continue;
    const name = new URL(r.resource).pathname.replace(/^\//, "").split("/")[0];
    if (name && !m.has(a.payTo.toLowerCase())) m.set(a.payTo.toLowerCase(), name.charAt(0).toUpperCase() + name.slice(1));
  }
  return m;
}
export const merchantLabel = (names: Map<string, string>, addr: string) => names.get(addr.toLowerCase()) ?? short(addr);
