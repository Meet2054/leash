#!/usr/bin/env node
/**
 * Make a deployment record reproducible: enrich contracts/deployments/<chainId>.json with
 *   - deploy tx hashes, blocks, gas (from Foundry's broadcast/run-latest.json)
 *   - build settings (solc, evm_version, optimizer) from contracts/foundry.toml
 *   - pinned dependency commits (ZKNox ETHFALCON, OpenZeppelin, forge-std)
 *   - the git commit that was deployed (DEPLOY_COMMIT, default HEAD) and the last commit touching contracts/src
 *   - a bytecode check: live runtime code == local artifact runtime code (immutable slots masked)
 * Usage: node scripts/record-deploy.mjs [chainId] [rpcUrl]   env: DEPLOY_COMMIT=<sha>
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const chainId = process.argv[2] ?? "1874";
const rpc = process.argv[3] ?? process.env.WHITECHAIN_RPC ?? "https://rpc.testnet.whitechain.io";
const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" }).trim();
const depPath = `${root}contracts/deployments/${chainId}.json`;
const dep = JSON.parse(readFileSync(depPath, "utf8"));
const broadcast = JSON.parse(readFileSync(`${root}contracts/broadcast/Deploy.s.sol/${chainId}/run-latest.json`, "utf8"));

async function call(method, params) {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

// ---- deploy transactions
const deployTxs = {};
for (let i = 0; i < broadcast.transactions.length; i++) {
  const t = broadcast.transactions[i];
  const r = broadcast.receipts[i];
  if (t.transactionType !== "CREATE") continue;
  deployTxs[t.contractName] = { address: t.contractAddress, tx: r.transactionHash, block: parseInt(r.blockNumber, 16), gasUsed: parseInt(r.gasUsed, 16) };
}
const block = await call("eth_getBlockByNumber", ["0x" + dep.deployedAtBlock.toString(16), false]);

// ---- build settings
const toml = readFileSync(`${root}contracts/foundry.toml`, "utf8");
const val = (k) => (toml.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\n]+)"?`, "m")) ?? [])[1];
const build = { solc: val("solc_version"), evmVersion: val("evm_version"), optimizer: val("optimizer") === "true", optimizerRuns: Number(val("optimizer_runs")), viaIR: false };

// ---- sources
const sub = (p) => git("rev-parse", `HEAD:contracts/lib/${p}`);
const deployCommit = process.env.DEPLOY_COMMIT ? git("rev-parse", process.env.DEPLOY_COMMIT) : git("rev-parse", "HEAD");
const sources = {
  repo: "this repository",
  deployCommit,
  contractsSourceCommit: git("log", "-1", "--format=%H", deployCommit, "--", "contracts/src"),
  deployScriptCommit: git("log", "-1", "--format=%H", deployCommit, "--", "contracts/script/Deploy.s.sol"),
  zknoxEthfalcon: { repo: "https://github.com/ZKNoxHQ/ETHFALCON", commit: sub("ETHFALCON") },
  openzeppelin: { repo: "https://github.com/OpenZeppelin/openzeppelin-contracts", tag: "v5.4.0", commit: sub("openzeppelin-contracts") },
  forgeStd: { commit: sub("forge-std") },
};

// ---- bytecode check (requires `forge build` at the same sources)
const artifactFor = { ZKNOX_ethfalcon: "ZKNOX_ethfalcon.sol/ZKNOX_ethfalcon.json", EthFalconVerifier: "EthFalconVerifier.sol/EthFalconVerifier.json", LeashFactory: "LeashFactory.sol/LeashFactory.json" };
const bytecodeCheck = {};
const check = async (name, address, artifactFile) => {
  const art = JSON.parse(readFileSync(`${root}contracts/out/${artifactFile}`, "utf8"));
  let local = art.deployedBytecode.object.slice(2).toLowerCase();
  let live = (await call("eth_getCode", [address, "latest"])).slice(2).toLowerCase();
  // mask immutables (constructor-set values baked into runtime code)
  for (const refs of Object.values(art.deployedBytecode.immutableReferences ?? {})) {
    for (const { start, length } of refs) {
      const z = "00".repeat(length);
      local = local.slice(0, start * 2) + z + local.slice((start + length) * 2);
      live = live.slice(0, start * 2) + z + live.slice((start + length) * 2);
    }
  }
  // the solc metadata hash at the tail can differ if comments/paths change; compare without it too
  const strip = (h) => { const n = parseInt(h.slice(-4), 16); return h.slice(0, h.length - (n + 2) * 2); };
  bytecodeCheck[name] = live === local ? "exact match (immutables masked)" : strip(live) === strip(local) ? "match except CBOR metadata" : "MISMATCH";
};
for (const [name, file] of Object.entries(artifactFor)) if (deployTxs[name]) await check(name, deployTxs[name].address, file);
await check("LeashVault (implementation)", dep.vaultImplementation, "LeashVault.sol/LeashVault.json");

const out = {
  ...dep,
  deployedAt: new Date(parseInt(block.timestamp, 16) * 1000).toISOString(),
  deployer: dep.relayer,
  deployTxs,
  build,
  sources,
  bytecodeCheck,
  verifiedOn: `https://explorer.testnet.whitechain.io (Blockscout)`,
};
writeFileSync(depPath, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ deployedAt: out.deployedAt, deployCommit, bytecodeCheck }, null, 2));
