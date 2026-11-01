// server.js: wires deny-list -> gate -> guarded store -> tools.
//
// The raw store is created and kept inside buildRuntime(). Tools, resources
// and seeding only ever receive objects built from the guarded store.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { loadGate, EXAMPLE_DENY_LIST_PATH } from "./screening/load-deny-list.js";
import { createGate, ScreeningError } from "./screening/screen.js";
import { MemoryStore, READ_METHODS, WRITE_METHODS } from "./store/memory-store.js";
import { createGuardedStore } from "./store/guarded-store.js";
import { createRecords } from "./lib/records.js";
import { createMemoryFiles } from "./lib/memory-files.js";
import { BUCKETS, DEFAULT_BUCKET } from "./lib/buckets.js";

import * as recordsList from "./tools/records.list.js";
import * as recordsGet from "./tools/records.get.js";
import * as recordsCreate from "./tools/records.create.js";
import * as recordsPin from "./tools/records.pin.js";
import * as decisionsLog from "./tools/decisions.log.js";
import * as inboxRecent from "./tools/inbox.recent.js";
import * as inboxSearch from "./tools/inbox.search.js";
import * as inboxCapture from "./tools/inbox.capture.js";
import * as inboxCaptureQuick from "./tools/inbox.capture_quick.js";
import * as inboxBuckets from "./tools/inbox.buckets.js";
import * as inboxRouteSuggest from "./tools/inbox.route_suggest.js";
import * as memoryView from "./tools/memory.view.js";
import * as memoryCreate from "./tools/memory.create.js";
import * as memoryStrReplace from "./tools/memory.str_replace.js";
import * as memoryInsert from "./tools/memory.insert.js";
import * as memoryDelete from "./tools/memory.delete.js";
import * as memoryRename from "./tools/memory.rename.js";
import * as corpusAnswer from './tools/corpus.answer.js'
import * as recentDecisions from "./resources/recent-decisions.js";

export const SERVER_INFO = Object.freeze({ name: "knowledge-mcp", version: "1.0.0" });

/** Every tool the server registers. Tests enumerate this list. */
export const TOOLS = Object.freeze([
  corpusAnswer,
  recordsList,
  recordsGet,
  recordsCreate,
  recordsPin,
  decisionsLog,
  inboxRecent,
  inboxSearch,
  inboxCapture,
  inboxCaptureQuick,
  inboxBuckets,
  inboxRouteSuggest,
  memoryView,
  memoryCreate,
  memoryStrReplace,
  memoryInsert,
  memoryDelete,
  memoryRename,
]);

export const RESOURCES = Object.freeze([recentDecisions]);

export const DEFAULT_SEED_PATH = fileURLToPath(new URL("../data/seed.json", import.meta.url));

const ACCESS = new Set(["read", "write"]);

/**
 * Build the store, gate and tool context.
 *
 * @param {object} [opts]
 * @param {string} [opts.denyListPath]  defaults to config/deny-list.example.json
 * @param {object} [opts.denyList]      an in-memory list (takes precedence; used by tests)
 * @param {string|null} [opts.storePath] JSON persistence path; null = memory only
 * @param {string|null} [opts.seedPath]  seed file; null = no seed
 * @param {string} [opts.ownerId]
 */
export function buildRuntime({
  denyListPath = EXAMPLE_DENY_LIST_PATH,
  denyList,
  storePath = null,
  seedPath = null,
  ownerId = "local-owner",
  now,
  writeMode = 'commit',
} = {}) {
  const gate = denyList ? createGate(denyList) : loadGate(denyListPath);
  const raw = new MemoryStore({ persistPath: storePath, now });

  // Data loaded from disk is screened before the server serves anything, so a
  // hand-edited store file or a tightened deny-list cannot leave matching
  // content readable.
  const loaded = raw.snapshot();
  const onDisk = gate.screen({ records: loaded.records, files: loaded.files });
  if (!onDisk.ok) {
    throw new ScreeningError(onDisk, "store load");
  }

  const store = createGuardedStore(raw, gate, { reads: READ_METHODS, writes: WRITE_METHODS, writeMode });
  const ctx = Object.freeze({
    records: createRecords({ store, ownerId }),
    memory: createMemoryFiles({ store, ownerId }),
    buckets: BUCKETS,
    defaultBucket: DEFAULT_BUCKET,
  });

  if (writeMode === 'commit' && seedPath && loaded.records.length === 0 && loaded.files.length === 0) {
    seedStore(ctx, JSON.parse(readFileSync(seedPath, "utf8")));
  }

  return {
    gate,
    store,
    ctx,
    ownerId,
    // Read-only view of everything persisted, for tests and --check.
    snapshot: () => raw.snapshot(),
  };
}

// Seeding is a write path like any other: it goes through the same tool-level
// functions, so the guarded store screens every seed entry. One rejected entry
// aborts startup.
function seedStore(ctx, seed) {
  for (const record of seed.records ?? []) {
    if (record.kind === "decision") ctx.records.logDecision(record);
    else if (record.kind === "capture") ctx.records.capture(record);
    else ctx.records.create(record);
  }
  for (const file of seed.files ?? []) {
    const result = ctx.memory.create({ path: file.path, file_text: file.content });
    if (result.startsWith("Error:")) throw new Error(`seed file ${file.path}: ${result}`);
  }
}

function toToolResult(output) {
  const text = typeof output === "string" ? output : output.text;
  const result = { content: [{ type: "text", text }] };
  if (output && typeof output === "object" && output.structured) result.structuredContent = output.structured;
  if (text.startsWith("Error:")) result.isError = true;
  return result;
}

export function buildServer(runtime, { tools = TOOLS } = {}) {
  const server = new McpServer(SERVER_INFO);
  for (const tool of tools) {
    if (!ACCESS.has(tool.access)) throw new Error(`tool ${tool.name} must declare access "read" or "write"`);
    server.registerTool(
      tool.name,
      {
        ...tool.config,
        annotations: { readOnlyHint: tool.access === "read", destructiveHint: tool.name === "memory.delete" },
      },
      async (args) => {
        try {
          return toToolResult(await tool.run(args ?? {}, runtime.ctx));
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: `${tool.name} failed: ${error.message}` }] };
        }
      },
    );
  }
  for (const resource of RESOURCES) {
    server.registerResource(resource.name, resource.uri, resource.config, async () => ({
      contents: [{ uri: resource.uri, mimeType: resource.config.mimeType, text: resource.read(runtime.ctx) }],
    }));
  }
  return server;
}
