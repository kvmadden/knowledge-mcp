// server.js: wires deny-list -> gate -> guarded store -> tools.
//
// The raw store is created and kept inside buildRuntime(). Tools, resources
// and seeding only ever receive objects built from the guarded store. The
// reviewer desk (approve, reject, retract) is returned to the operator and is
// never part of the tool context.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { loadGate, EXAMPLE_DENY_LIST_PATH } from "./screening/load-deny-list.js";
import { createGate, ScreeningError } from "./screening/screen.js";
import { CLASSIFICATION, MemoryStore, SCREENED_ARGS } from "./store/memory-store.js";
import { AUDIT_OPS, createWriteGuard } from "./store/guarded-store.js";
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

const AUDIT_STRING_KEYS = new Set(["op", "target", "decision", "payload_sha256", "result_ref", "hold_id", "reviewer", "policy", "at", "path"]);

/**
 * Screens state read from disk, item by item, each with its own budget, so
 * a large store can always be reopened. An item that matches a block rule
 * refuses the load. An item the current policy would hold for review is
 * listed in the load report but stays readable. Items already screened in
 * this process are skipped by content hash, so rereading a store that
 * another process changed only screens what changed.
 */
export function createLoadVerifier(gate) {
  const passed = new Map();
  let report = { reviewItems: [], screenedItems: 0 };
  const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const refuse = (where, verdict) => {
    const first = verdict.violations[0];
    const error = new ScreeningError({ ...verdict, violations: [{ ...first, field: `${where}${first.field && first.field !== "(value)" ? `.${first.field}` : ""}` }] }, "store load");
    error.message += ". Run `knowledge-mcp store scan` to list blocking items and `knowledge-mcp store purge --apply --reviewer <label>` to remove them.";
    throw error;
  };
  function verify(state) {
    const reviewItems = [];
    let screened = 0;
    const check = (key, where, value) => {
      const hash = digest(value);
      const known = passed.get(key);
      if (known && known.hash === hash) {
        if (known.review) reviewItems.push(where);
        return;
      }
      const verdict = gate.screen(value);
      screened += 1;
      if (verdict.decision === "block") refuse(where, verdict);
      passed.set(key, { hash, review: verdict.decision === "review" });
      if (verdict.decision === "review") reviewItems.push(where);
    };
    state.records.forEach((r, i) => check(`r:${r.id}`, `records[${i}]`, r));
    state.files.forEach((f, i) => check(`f:${f.owner_id}:${f.path}`, `files[${i}]`, f));
    state.pending.forEach((p, i) => {
      const verdict = gate.screen(p.args);
      screened += 1;
      if (verdict.decision === "block") refuse(`pending[${i}]`, verdict);
    });
    state.audit.forEach((entry, i) => {
      for (const [key, value] of Object.entries(entry)) {
        const ok = typeof value === "number" || typeof value === "boolean" || value === null || Array.isArray(value) || (typeof value === "string" && AUDIT_STRING_KEYS.has(key)) || (key === "details" && value && typeof value === "object") || (key === "counts" && value && typeof value === "object");
        if (!ok) refuse(`audit[${i}]`, { violations: [{ field: key, patternId: "unexpected-audit-field" }] });
      }
      const verdict = gate.screen(entry);
      if (verdict.decision === "block") refuse(`audit[${i}]`, verdict);
    });
    report = { reviewItems, screenedItems: screened };
  }
  return { verify, report: () => ({ ...report, reviewItems: [...report.reviewItems] }) };
}

/**
 * Build the store, gate, tool context and reviewer desk.
 *
 * @param {object} [opts]
 * @param {string} [opts.denyListPath]  defaults to config/deny-list.example.json
 * @param {object} [opts.denyList]      an in-memory list (takes precedence; used by tests)
 * @param {string|null} [opts.storePath] JSON persistence path; null = memory only
 * @param {string|null} [opts.seedPath]  seed file; null = no seed
 * @param {string} [opts.ownerId]
 * @param {() => string} [opts.now]     clock, for reproducible evidence
 * @param {string} [opts.writeMode]     "commit" or "dry-run"
 * @param {number} [opts.lockTimeoutMs] how long a write waits for another process
 */
export function buildRuntime({
  denyListPath = EXAMPLE_DENY_LIST_PATH,
  denyList,
  storePath = null,
  seedPath = null,
  ownerId = "local-owner",
  now,
  writeMode = 'commit',
  lockTimeoutMs,
} = {}) {
  const gate = denyList ? createGate(denyList) : loadGate(denyListPath);
  const verifier = createLoadVerifier(gate);
  const raw = new MemoryStore({ persistPath: storePath, now, verify: verifier.verify, lockTimeoutMs });
  // An in-memory store has nothing on disk; screen it anyway so the report is complete.
  if (!storePath) verifier.verify(raw.snapshot());
  const loaded = raw.snapshot();

  const { store, review } = createWriteGuard(raw, gate, { ...CLASSIFICATION, screenedArgs: SCREENED_ARGS, writeMode });
  const clock = now ?? (() => new Date().toISOString());
  const ctx = Object.freeze({
    records: createRecords({ store, ownerId, now: clock }),
    memory: createMemoryFiles({ store, ownerId }),
    buckets: BUCKETS,
    defaultBucket: DEFAULT_BUCKET,
  });

  let seeded = false;
  if (writeMode === 'commit' && seedPath && loaded.records.length === 0 && loaded.files.length === 0) {
    seedStore(ctx, JSON.parse(readFileSync(seedPath, "utf8")));
    seeded = true;
  }

  return {
    gate,
    store,
    ctx,
    ownerId,
    seeded,
    writeMode,
    // The reviewer desk, bound to this owner. Not given to tools.
    review: Object.freeze({
      list: () => review.list(),
      get: (id) => review.get(id),
      approve: (id, opts) => review.approve(id, opts),
      reject: (id, opts) => review.reject(id, opts),
      retract: (recordId, opts) => review.retract(ownerId, recordId, opts),
    }),
    loadReport: () => verifier.report(),
    // Read-only view of everything persisted, for tests and --check.
    snapshot: () => raw.snapshot(),
  };
}

export { AUDIT_OPS };

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
