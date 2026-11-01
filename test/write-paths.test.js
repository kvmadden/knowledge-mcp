// Every tool in the registry, every string argument, every deny-list pattern.
//
// The test is driven by TOOLS (the list buildServer registers), not by a
// hand-kept list of write tools. A new tool without a fixture below fails the
// "fixture coverage" test; a new tool that writes matching content anywhere
// in the store fails the injection test. The "canary" test runs the same
// harness against tools wired to the raw (unscreened) store and confirms the
// harness reports them, so a passing run means something.

import test from "node:test";
import assert from "node:assert/strict";

import { RESOURCES, TOOLS } from "../src/server.js";
import { MemoryStore } from "../src/store/memory-store.js";
import { createRecords } from "../src/lib/records.js";
import { createMemoryFiles } from "../src/lib/memory-files.js";
import { BUCKETS, DEFAULT_BUCKET } from "../src/lib/buckets.js";
import { SAMPLES, connect, dataOf, newRuntime, stringLeaves, textOf, withLeaf } from "./_helpers.js";

const seedFile = (ctx) => ctx.memory.create({ path: "/memories/notes/a.md", file_text: "alpha\nbeta" });
const seedRecord = (ctx) => ctx.records.create({ text: "a record to pin", bucket: "projects" });

// Valid arguments for every registered tool. `setup` runs through the guarded
// context before the call so the baseline call has something to act on.
const FIXTURES = {
  "corpus.answer": { args: { question: "oxygen", collection: "public" } },
  "records.list": { args: { type: "note", bucket: "projects", buckets: ["projects"], since: "2000-01-01T00:00:00.000Z", titledOnly: false, limit: 5 } },
  "records.get": { setup: seedRecord, args: { id: "rec_0001" } },
  "records.create": {
    args: { text: "Plan the sprint review.", type: "note", bucket: "projects", title: "Sprint review", summary: "Agenda draft", tags: ["planning"] },
  },
  // lookupOnly: every caller-supplied string only locates existing data, so
  // there is no new content for a planted value to ride in on.
  "records.pin": { setup: seedRecord, args: { id: "rec_0001", pinned: true }, lookupOnly: true },
  "decisions.log": { args: { title: "Use weekly digests", summary: "Grouped by bucket", context: "Alternative was daily.", bucket: "decisions" } },
  "inbox.recent": { args: { bucket: "projects", since: "2000-01-01T00:00:00.000Z", limit: 5 } },
  "inbox.search": { setup: seedRecord, args: { query: "record", bucket: "projects", sourceApp: "knowledge-mcp", since: "2000-01-01T00:00:00.000Z", limit: 5 } },
  "inbox.capture": {
    args: { text: "Test the cold start path.", source_app: "notes-app", suggested_bucket: "ideas", tags: ["test"], link_url: "https://example.org/a" },
  },
  "inbox.capture_quick": { args: { text: "Quick note about the demo." } },
  "inbox.buckets": { args: { include_descriptions: true } },
  "inbox.route_suggest": { args: { text: "benchmark notes for the research project" } },
  "memory.view": { setup: seedFile, args: { path: "/memories/notes/a.md", view_range: [1, 2] } },
  "memory.create": { args: { path: "/memories/notes/new.md", file_text: "hello" } },
  "memory.str_replace": { setup: seedFile, args: { path: "/memories/notes/a.md", old_str: "beta", new_str: "gamma" } },
  "memory.insert": { setup: seedFile, args: { path: "/memories/notes/a.md", insert_line: 1, insert_text: "inserted" } },
  "memory.delete": { setup: seedFile, args: { path: "/memories/notes/a.md" }, lookupOnly: true },
  "memory.rename": { setup: seedFile, args: { old_path: "/memories/notes/a.md", new_path: "/memories/notes/b.md" } },
};

// Two ways to plant a value: replace the whole argument, or append to a
// valid one (so the argument still passes schema and path validation and the
// value reaches the store layer).
const VARIANTS = {
  replace: (_old, sample) => sample,
  append: (old, sample) => `${old} ${sample}`,
};

function guardedRuntime() {
  return newRuntime();
}

// Tools wired straight to the raw store: what the original code effectively
// did for several write paths. Used only by the canary test.
function unscreenedRuntime() {
  const raw = new MemoryStore();
  const ctx = Object.freeze({
    records: createRecords({ store: raw, ownerId: "local-owner" }),
    memory: createMemoryFiles({ store: raw, ownerId: "local-owner" }),
    buckets: BUCKETS,
    defaultBucket: DEFAULT_BUCKET,
  });
  return { ctx, snapshot: () => raw.snapshot() };
}

async function call(runtime, tool, args) {
  const { client, close } = await connect(runtime, { tools: [tool] });
  try {
    return await client.callTool({ name: tool.name, arguments: args });
  } finally {
    await close();
  }
}

/**
 * Run one tool through every (string argument x pattern sample x variant)
 * case. Returns the failures plus counts used by the assertions.
 */
async function auditTool(tool, makeRuntime) {
  const fixture = FIXTURES[tool.name];
  const failures = [];
  let cases = 0;
  let screenBlocked = 0;

  // Baseline: valid arguments behave as the declared access says.
  {
    const runtime = makeRuntime();
    fixture.setup?.(runtime.ctx);
    const before = runtime.snapshot();
    const result = await call(runtime, tool, fixture.args);
    const after = runtime.snapshot();
    if (result.isError) failures.push(`${tool.name}: baseline call failed: ${textOf(result)}`);
    const changed = dataOf(before) !== dataOf(after);
    if (tool.access === "write" && !changed) failures.push(`${tool.name}: declared write but baseline call changed nothing`);
    if (tool.access === "read" && JSON.stringify(before) !== JSON.stringify(after)) {
      failures.push(`${tool.name}: declared read but baseline call changed the store`);
    }
  }

  for (const leaf of stringLeaves(fixture.args)) {
    for (const [patternId, sample] of Object.entries(SAMPLES)) {
      for (const [variant, plant] of Object.entries(VARIANTS)) {
        cases += 1;
        const runtime = makeRuntime();
        fixture.setup?.(runtime.ctx);
        const before = runtime.snapshot();
        const args = withLeaf(fixture.args, leaf, (old) => plant(old, sample));
        const result = await call(runtime, tool, args);
        const after = runtime.snapshot();
        const where = `${tool.name} ${leaf.join(".")} ${patternId}/${variant}`;
        if (dataOf(before) !== dataOf(after)) failures.push(`${where}: store data changed`);
        if (JSON.stringify(after).includes(sample)) failures.push(`${where}: sample value persisted`);
        if (after.audit.length > before.audit.length) {
          const added = after.audit.slice(before.audit.length);
          if (added.some((e) => e.op === "screen_blocked")) screenBlocked += 1;
          else if (tool.access === "write") failures.push(`${where}: audit grew without a screen_blocked entry`);
        }
        if (tool.access === "write" && !result.isError && !/No replacement was performed/.test(textOf(result))) {
          failures.push(`${where}: write call reported success`);
        }
      }
    }
  }
  return { failures, cases, screenBlocked };
}

test("every registered tool declares access and has a fixture", () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "tool names are unique");
  for (const tool of TOOLS) {
    assert.ok(["read", "write"].includes(tool.access), `${tool.name} declares access read or write`);
    assert.equal(typeof tool.run, "function", `${tool.name} exports run()`);
  }
  assert.deepEqual(
    Object.keys(FIXTURES).sort(),
    [...names].sort(),
    "FIXTURES must cover exactly the registered tools; add a fixture when you add a tool",
  );
});

test("the MCP server exposes exactly the registry, with readOnlyHint matching access", async () => {
  const runtime = guardedRuntime();
  const { client, close } = await connect(runtime);
  const { tools } = await client.listTools();
  await close();
  assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS.map((t) => t.name).sort());
  for (const listed of tools) {
    const declared = TOOLS.find((t) => t.name === listed.name);
    assert.equal(listed.annotations?.readOnlyHint, declared.access === "read", `${listed.name} readOnlyHint`);
  }
});

const WRITE_TOOLS = TOOLS.filter((t) => t.access === "write");
const READ_TOOLS = TOOLS.filter((t) => t.access === "read");

test("write tools are the expected set", () => {
  assert.deepEqual(WRITE_TOOLS.map((t) => t.name).sort(), [
    "decisions.log",
    "inbox.capture",
    "inbox.capture_quick",
    "memory.create",
    "memory.delete",
    "memory.insert",
    "memory.rename",
    "memory.str_replace",
    "records.create",
    "records.pin",
  ]);
});

for (const tool of WRITE_TOOLS) {
  test(`write tool ${tool.name}: no deny-listed value in any argument reaches the store`, async () => {
    const { failures, cases, screenBlocked } = await auditTool(tool, guardedRuntime);
    assert.deepEqual(failures, []);
    assert.ok(cases > 0, "at least one string argument was exercised");
    if (!FIXTURES[tool.name].lookupOnly) {
      assert.ok(screenBlocked > 0, "at least one case was stopped by the screening gate itself");
    }
  });
}

for (const tool of READ_TOOLS) {
  test(`read tool ${tool.name}: never changes the store`, async () => {
    const { failures } = await auditTool(tool, guardedRuntime);
    assert.deepEqual(failures, []);
  });
}

test("resources are read-only and do not change the store", async () => {
  const runtime = guardedRuntime();
  runtime.ctx.records.logDecision({ title: "A decision" });
  const before = JSON.stringify(runtime.snapshot());
  const { client, close } = await connect(runtime);
  for (const resource of RESOURCES) {
    assert.equal(resource.access, "read");
    const out = await client.readResource({ uri: resource.uri });
    assert.ok(out.contents[0].text.length > 0);
  }
  await close();
  assert.equal(JSON.stringify(runtime.snapshot()), before);
});

test("canary: the same harness flags every write tool when tools are wired to the raw store", async () => {
  const leaky = WRITE_TOOLS.filter((t) => !FIXTURES[t.name].lookupOnly);
  assert.equal(leaky.length, 8);
  for (const tool of leaky) {
    const { failures } = await auditTool(tool, unscreenedRuntime);
    assert.ok(
      failures.some((f) => f.includes("sample value persisted")),
      `${tool.name} should be flagged when screening is bypassed (got ${failures.length} failures)`,
    );
  }
});
