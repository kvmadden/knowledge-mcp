// Startup fails closed: a bad deny-list, a store file with matching content,
// or a seed entry with matching content stops the server before it serves.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildRuntime } from "../src/server.js";
import { SAMPLES } from "./_helpers.js";

const ENTRY = fileURLToPath(new URL("../src/index.js", import.meta.url));

function tmp() {
  const dir = mkdtempSync(path.join(tmpdir(), "knowledge-mcp-test-"));
  return { dir, file: (name, body) => { const p = path.join(dir, name); if (body !== undefined) writeFileSync(p, body); return p; }, done: () => rmSync(dir, { recursive: true, force: true }) };
}

function runCli(env, args = ["--check"]) {
  return spawnSync(process.execPath, [ENTRY, ...args], { env: { PATH: process.env.PATH, KNOWLEDGE_SEED: "none", ...env }, encoding: "utf8" });
}

test("--check with defaults reports the in-memory store, seed and example list", () => {
  const out = runCli({ KNOWLEDGE_SEED: "" });
  assert.equal(out.status, 0, out.stderr);
  const cfg = JSON.parse(out.stdout);
  assert.equal(cfg.store, "in-memory");
  assert.equal(cfg.records, 7);
  assert.equal(cfg.memoryFiles, 2);
  assert.equal(cfg.tools.length, 17);
  assert.equal(cfg.denyListPatterns.length, 6);
});

test("missing, empty, malformed or invalid deny-list files stop startup", () => {
  const t = tmp();
  try {
    const cases = {
      missing: path.join(t.dir, "nope.json"),
      empty: t.file("empty.json", JSON.stringify({ patterns: [] })),
      malformed: t.file("bad.json", "{not json"),
      badRegex: t.file("regex.json", JSON.stringify({ patterns: [{ id: "x", pattern: "(" }] })),
    };
    for (const [label, file] of Object.entries(cases)) {
      const out = runCli({ DENY_LIST_PATH: file });
      assert.equal(out.status, 1, label);
      assert.match(out.stderr, /startup failed/, label);
    }
  } finally {
    t.done();
  }
});

test("a store file containing matching content is refused at load", () => {
  const t = tmp();
  try {
    const storePath = t.file("store.json");
    const rt = buildRuntime({ storePath });
    rt.ctx.records.create({ text: "clean note" });
    const state = JSON.parse(readFileSync(storePath, "utf8"));
    state.records[0].text = `edited by hand: ${SAMPLES["email-address"]}`;
    writeFileSync(storePath, JSON.stringify(state));
    assert.throws(() => buildRuntime({ storePath }), /store load rejected by screening/);
    const out = runCli({ KNOWLEDGE_STORE_PATH: storePath });
    assert.equal(out.status, 1);
  } finally {
    t.done();
  }
});

test("a tightened deny-list refuses previously accepted data", () => {
  const t = tmp();
  try {
    const storePath = t.file("store.json");
    buildRuntime({ storePath }).ctx.records.create({ text: "Project Bluebird kickoff" });
    assert.doesNotThrow(() => buildRuntime({ storePath }));
    const strict = { patterns: [{ id: "codename", pattern: "bluebird", flags: "i" }] };
    assert.throws(() => buildRuntime({ storePath, denyList: strict }), /store load rejected/);
  } finally {
    t.done();
  }
});

test("a seed entry with matching content aborts startup", () => {
  const t = tmp();
  try {
    const seedPath = t.file("seed.json", JSON.stringify({ records: [{ kind: "note", text: "ok" }, { kind: "capture", text: `call ${SAMPLES["us-phone-number"]}` }] }));
    assert.throws(() => buildRuntime({ seedPath }), /rejected by screening/);
    const fileSeed = t.file("seed2.json", JSON.stringify({ files: [{ path: "/memories/a.md", content: SAMPLES["us-ssn-format"] }] }));
    assert.throws(() => buildRuntime({ seedPath: fileSeed }), /seed file/);
  } finally {
    t.done();
  }
});

test("JSON-file store persists across runtimes", () => {
  const t = tmp();
  try {
    const storePath = t.file("store.json");
    buildRuntime({ storePath }).ctx.records.create({ text: "kept" });
    const again = buildRuntime({ storePath });
    assert.equal(again.ctx.records.get("rec_0001").text, "kept");
    assert.equal(again.ctx.records.create({ text: "next" }).id, "rec_0002");
  } finally {
    t.done();
  }
});
