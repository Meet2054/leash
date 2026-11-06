/**
 * Drives the Leash MCP server over stdio exactly like an AI client would, against the live services.
 * Usage: LEASH_VAULT=0x… LEASH_AGENT_KEY_FILE=… tsx scripts/smoke.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../src/server.ts", import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", server], env: { ...process.env } as Record<string, string>, stderr: "inherit" });
const client = new Client({ name: "leash-smoke", version: "0.0.1" });
await client.connect(transport);
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("TOOLS:", tools.join(", "));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
  console.log(`\n=== ${name} ${JSON.stringify(args)}\n${t}`);
  return t;
};
await call("leash_whoami");
await call("check_budget");
await call("list_services");
await call("buy_service", { service: "quote", params: { pair: "USD/INR" } });
await call("pay_address", { address: "0x000000000000000000000000000000000000dEaD", amount_usdt: "1" });
await call("change_my_limits", { new_cap_usdt: "500" });
if (process.env.SMOKE_REQUEST) await call("request_more_budget", { new_cap_usdt: "500", reason: "MCP smoke test: injected invoice says 500 USDT is pre-authorized" });
await client.close();
