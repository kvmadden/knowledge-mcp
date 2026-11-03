#!/usr/bin/env node
// Entry point: serve over stdio, print configuration, or run an operator
// command (review queue, record retraction, store scan and purge, screening a
// text). Operator commands work on a persisted store (KNOWLEDGE_STORE_PATH)
// and are never reachable through MCP tools.
import process from "node:process";
import path from "node:path";
import { readFileSync } from "node:fs";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildRuntime, buildServer, DEFAULT_SEED_PATH, RESOURCES, SERVER_INFO, TOOLS } from "./server.js";
import { EXAMPLE_DENY_LIST_PATH, loadGate } from "./screening/load-deny-list.js";
import { POLICY_VERSION } from "./screening/screen.js";
import { purgeStore, scanStore } from "./store/maintenance.js";

const USAGE = `Usage:
  node src/index.js                                   serve MCP over stdio
  node src/index.js --check                           print configuration and the load report, then exit
  node src/index.js screen --text "..." | --file F    print the screening verdict for a text (no values echoed)
  node src/index.js review list                       list held writes
  node src/index.js review show <hold-id>             print one held write, payload included, for the reviewer
  node src/index.js review approve <hold-id> --reviewer <label>
  node src/index.js review reject <hold-id> --reviewer <label>
  node src/index.js records retract <record-id> --reviewer <label> [--reason "..."]
  node src/index.js store scan                        list items that block loading or need review
  node src/index.js store purge [--apply --reviewer <label>]

Operator commands need KNOWLEDGE_STORE_PATH. Reviewer labels are recorded in
the audit log. They are not authenticated.
`;

export function configFromEnv(env = process.env) {
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

function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requireStore(cfg) {
  if (!cfg.storePath) throw new Error("this command needs KNOWLEDGE_STORE_PATH (a persisted store)");
}

function operatorRuntime(cfg) {
  requireStore(cfg);
  return buildRuntime({ ...cfg, seedPath: null, writeMode: "commit" });
}

async function main(argv = process.argv.slice(2)) {
  const cfg = configFromEnv();
  const [command, sub, target] = argv;
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  if (command === "--check") {
    const runtime = buildRuntime(cfg);
    const snap = runtime.snapshot();
    const report = runtime.loadReport();
    print({
      server: SERVER_INFO,
      store: cfg.storePath ? "json-file" : "in-memory",
      seeded: runtime.seeded,
      denyListPatterns: runtime.gate.patternIds,
      policyChecks: runtime.gate.policyIds,
      policy: { version: POLICY_VERSION, id: runtime.gate.policyId },
      writeMode: cfg.writeMode,
      records: snap.records.length,
      memoryFiles: snap.files.length,
      heldForReview: snap.pending.length,
      storedItemsCurrentPolicyWouldHold: report.reviewItems.length,
      tools: TOOLS.map((t) => ({ name: t.name, access: t.access })),
      resources: RESOURCES.map((r) => r.uri),
    });
    return;
  }
  if (command === "screen") {
    const gate = loadGate(cfg.denyListPath);
    const file = option(argv, "--file");
    const text = file ? readFileSync(path.resolve(file), "utf8") : option(argv, "--text");
    if (typeof text !== "string") throw new Error('screen needs --text "..." or --file <path>');
    const verdict = gate.screen({ text });
    print({
      decision: verdict.decision,
      finding: verdict.finding ?? null,
      rule_ids: [...new Set([...verdict.violations.map((v) => v.patternId), ...verdict.reviews.map((r) => r.reasonId)])],
      read: verdict.read ?? null,
      policy: verdict.policyId,
    });
    return;
  }
  if (command === "review") {
    const runtime = operatorRuntime(cfg);
    if (sub === "list") return print(runtime.review.list());
    if (sub === "show") {
      const held = runtime.review.get(target);
      if (!held) throw new Error("hold not found");
      return print(held);
    }
    if (sub === "approve") return print(runtime.review.approve(target, { reviewer: option(argv, "--reviewer") }));
    if (sub === "reject") return print(runtime.review.reject(target, { reviewer: option(argv, "--reviewer") }));
    throw new Error("review needs list, show, approve or reject");
  }
  if (command === "records" && sub === "retract") {
    const runtime = operatorRuntime(cfg);
    return print(runtime.review.retract(target, { reviewer: option(argv, "--reviewer"), reason: option(argv, "--reason") }));
  }
  if (command === "store") {
    requireStore(cfg);
    const gate = loadGate(cfg.denyListPath);
    if (sub === "scan") return print(scanStore(cfg.storePath, gate));
    if (sub === "purge") return print(purgeStore(cfg.storePath, gate, { apply: argv.includes("--apply"), reviewer: option(argv, "--reviewer") }));
    throw new Error("store needs scan or purge");
  }
  if (command) throw new Error(`unknown command "${command}". Run knowledge-mcp --help.`);

  const runtime = buildRuntime(cfg);
  const server = buildServer(runtime);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[knowledge-mcp] serving ${TOOLS.length} tools on stdio (${cfg.storePath ? "json-file" : "in-memory"} store, ${cfg.writeMode} mode)\n`);
}

main().catch((error) => {
  process.stderr.write(`[knowledge-mcp] startup failed: ${error.message}\n`);
  process.exit(1);
});
