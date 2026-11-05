import "server-only";
import { NextResponse } from "next/server";

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export function ok(body: unknown, status = 200) {
  return new NextResponse(JSON.stringify(body, replacer), { status, headers: { "content-type": "application/json" } });
}

export function err(message: string, status = 400) {
  return ok({ error: message }, status);
}

export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 400);
  }
}
