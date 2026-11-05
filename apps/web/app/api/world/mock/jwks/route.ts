import { mockJwks } from "@/lib/server/world";
import { ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** JWKS of the MOCKED local issuer (for transparency; validation uses the same keys in-process). */
export async function GET() {
  return ok(await mockJwks());
}
