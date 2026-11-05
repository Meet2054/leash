import { AccountId, Client, PrivateKey, TopicCreateTransaction, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";

export type ExternalLog = { publish: (msg: string) => Promise<string | undefined>; describe: () => Record<string, unknown> };

export function parseHederaKey(raw: string): PrivateKey {
  const k = raw.trim();
  if (k.startsWith("302") || k.startsWith("303")) return PrivateKey.fromStringDer(k); // DER
  return PrivateKey.fromStringECDSA(k.replace(/^0x/, ""));
}

export function operatorClient(operatorId: string, operatorKey: string): Client {
  return Client.forTestnet().setOperator(AccountId.fromString(operatorId), parseHederaKey(operatorKey));
}

export const hashscan = {
  topic: (id: string) => `https://hashscan.io/testnet/topic/${id}`,
  tx: (id: string) => `https://hashscan.io/testnet/transaction/${id}`,
  account: (id: string) => `https://hashscan.io/testnet/account/${id}`,
};

/** Create the Leash audit topic (submit key = operator, so only the facilitator can append). */
export async function createAuditTopic(operatorId: string, operatorKey: string): Promise<string> {
  const client = operatorClient(operatorId, operatorKey);
  const tx = await new TopicCreateTransaction()
    .setTopicMemo("Leash audit log: channel opens, claims, mandate changes, approvals and denials")
    .setSubmitKey(parseHederaKey(operatorKey).publicKey)
    .execute(client);
  const receipt = await tx.getReceipt(client);
  client.close();
  return receipt.topicId!.toString();
}

/**
 * Tamper-evident audit log on a Hedera Consensus Service topic. Each event is one HCS message with a
 * consensus timestamp and sequence number; anyone can read it from the mirror node or HashScan.
 */
export async function createHcsLog(o: { operatorId: string; operatorKey: string; topicId: string }): Promise<ExternalLog> {
  const client = operatorClient(o.operatorId, o.operatorKey);
  const topic = TopicId.fromString(o.topicId);
  return {
    async publish(msg: string) {
      const tx = await new TopicMessageSubmitTransaction().setTopicId(topic).setMessage(msg.slice(0, 1000)).execute(client);
      const r = await tx.getReceipt(client);
      return `${o.topicId}#${r.topicSequenceNumber?.toString()}`;
    },
    describe: () => ({ topicId: o.topicId, hashscan: hashscan.topic(o.topicId) }),
  };
}
