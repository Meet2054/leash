/** Post the first message to the audit topic (proves the current operator can write to it). */
import { createHcsLog, hashscan } from "./hcs";
const log = await createHcsLog({ operatorId: process.env.HEDERA_OPERATOR_ID!, operatorKey: process.env.HEDERA_OPERATOR_KEY!, topicId: process.env.HCS_TOPIC_ID! });
const ref = await log.publish(JSON.stringify({ event: "AuditLogStarted", project: "Leash", operator: process.env.HEDERA_OPERATOR_ID, ts: Math.floor(Date.now() / 1000) }));
console.log(`✓ genesis message ${ref}  ${hashscan.topic(process.env.HCS_TOPIC_ID!)}`);
process.exit(0);
