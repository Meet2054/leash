import { startApprovalAttempt } from "@/lib/server/attestor";
import { handle, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Owner taps Approve → start a World ID check bound to this exact change. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => ok(await startApprovalAttempt(id)));
}
