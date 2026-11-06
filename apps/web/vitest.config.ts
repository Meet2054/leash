import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
// `server-only` throws outside a React Server Components bundle; server modules are unit-tested in plain Node.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000 },
  resolve: { alias: { "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)) } },
});
