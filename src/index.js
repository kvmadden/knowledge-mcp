#!/usr/bin/env node
// Entry point: serve over stdio, or print configuration with --check.
import process from "node:process";
import path from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildRuntime, buildServer, DEFAULT_SEED_PATH, RESOURCES, SERVER_INFO, TOOLS } from "./server.js";
import { EXAMPLE_DENY_LIST_PATH } from "./screening/load-deny-list.js";

function configFromEnv(env = process.env) {
  const storePath = env.KNOWLEDGE_STORE_PATH ? path.resolve(env.KNOWLEDGE_STORE_PATH) : null;
  const seed = env.KNOWLEDGE_SEED;
  const seedPath = seed === "none" ? null : seed ? path.resolve(seed) : DEFAULT_SEED_PATH;
  return {
    denyListPath: env.DENY_LIST_PATH ? path.resolve(env.DENY_LIST_PATH) : EXAMPLE_DENY_LIST_PATH,
    storePath,
    writeMode: env.KNOWLEDGE_WRITE_MODE || 'commit',
    seedPath,
    ownerId: env.OWNER_ID || "local-owner",
  };
}

async function main() {
  const cfg = configFromEnv();
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write("Usage: knowledge-mcp            serve over stdio\n       knowledge-mcp --check    print configuration and exit\n");
    return;
  }
  const runtime = buildRuntime(cfg);
  if (process.argv.includes("--check")) {
    const snap = runtime.snapshot();
    process.stdout.write(
      JSON.stringify(
        {
          server: SERVER_INFO,
          store: cfg.storePath ? "json-file" : "in-memory",
          seeded: cfg.writeMode === 'commit' && Boolean(cfg.seedPath),
          denyListPatterns: runtime.gate.patternIds,
          policyChecks: runtime.gate.policyIds,
          writeMode: cfg.writeMode,
          records: snap.records.length,
          memoryFiles: snap.files.length,
          tools: TOOLS.map((t) => ({ name: t.name, access: t.access })),
          resources: RESOURCES.map((r) => r.uri),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  const server = buildServer(runtime);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[knowledge-mcp] serving ${TOOLS.length} tools on stdio (${cfg.storePath ? "json-file" : "in-memory"} store)\n`);
}

main().catch((error) => {
  process.stderr.write(`[knowledge-mcp] startup failed: ${error.message}\n`);
  process.exit(1);
});
