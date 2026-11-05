import { advanceAttempt, publicAttempt } from "@/lib/server/attestor";
import { handle, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Poll a World check. The server talks to the IdP; the browser only sees status (never the device_code). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => ok(publicAttempt(await advanceAttempt(id))));
}
