import type { ExternalLog } from "./audit.js";

/**
 * Optional Hedera Consensus Service mirror for the audit log (spec §10). Enabled when
 * HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY and HCS_TOPIC_ID are set; implemented in @leash/hedera.
 */
export async function hcsFromEnv(): Promise<ExternalLog | undefined> {
  const { HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HCS_TOPIC_ID } = process.env;
  if (!HEDERA_OPERATOR_ID || !HEDERA_OPERATOR_KEY || !HCS_TOPIC_ID || HCS_TOPIC_ID.includes("placeholder")) return undefined;
  try {
    const mod = (await import("@leash/hedera" as string)) as { createHcsLog: (o: Record<string, string>) => Promise<ExternalLog> };
    return await mod.createHcsLog({ operatorId: HEDERA_OPERATOR_ID, operatorKey: HEDERA_OPERATOR_KEY, topicId: HCS_TOPIC_ID });
  } catch (e) {
    console.warn("[facilitator] HCS mirror disabled:", e instanceof Error ? e.message : e);
    return undefined;
  }
}
