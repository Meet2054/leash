import { ollamaModels } from "@/lib/server/lab";
import { ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Local models this server can run (via Ollama), for the attack lab's model picker. */
export async function GET() {
  return ok({ ollama: await ollamaModels() });
}
