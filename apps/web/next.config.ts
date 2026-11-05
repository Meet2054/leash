import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  transpilePackages: ["@leash/sdk"],
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  turbopack: { root: fileURLToPath(new URL("../../", import.meta.url)) },
  serverExternalPackages: [],
  agentRules: false,
};
export default config;
