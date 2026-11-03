// Static checks on the source tree: only the startup wiring may import the
// raw store, and nothing in the repo reads service-role credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".js") || p.endsWith(".mjs") ? [p] : [];
  });
}

const SOURCE = [...files(path.join(ROOT, "src")), ...files(path.join(ROOT, "web")), ...files(path.join(ROOT, "scripts")), ...files(path.join(ROOT, "eval")), ...files(path.join(ROOT, "examples"))];

// Every module specifier in a file: static imports and re-exports with either
// quote style, dynamic import() calls and require() calls.
export function specifiers(text) {
  const out = [];
  for (const m of text.matchAll(/\b(?:import|export)\s[^'"`;]*?\bfrom\s*(['"`])([^'"`]+)\1/g)) out.push(m[2]);
  for (const m of text.matchAll(/\bimport\s*(['"`])([^'"`]+)\1/g)) out.push(m[2]);
  for (const m of text.matchAll(/\b(?:import|require)\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)) out.push(m[2]);
  for (const m of text.matchAll(/\bimport\s*\(\s*`([^`]*)`/g)) out.push(m[1]);
  return out;
}

test("the specifier scan sees every import style, so a boundary test cannot be dodged by quoting", () => {
  const sample = [
    'import a from "../store/memory-store.js";',
    "import { b } from '../store/memory-store.js'",
    'export * from "../store/memory-store.js"',
    "const c = await import('../store/memory-store.js')",
    'const d = require("../store/memory-store.js")',
    "import '../store/memory-store.js'",
  ].join("\n");
  assert.equal(specifiers(sample).filter((s) => s.endsWith("memory-store.js")).length, 6);
});

test("only src/server.js and src/store/ import the raw memory store", () => {
  const importers = SOURCE.filter((f) => specifiers(readFileSync(f, "utf8")).some((s) => s.endsWith("memory-store.js"))).map((f) => path.relative(ROOT, f));
  assert.deepEqual(importers.filter((f) => !f.startsWith("src/store/")), ["src/server.js"]);
});

test("tools import nothing that can write to a store", () => {
  for (const f of files(path.join(ROOT, "src/tools"))) {
    const imports = specifiers(readFileSync(f, "utf8"));
    assert.ok(imports.length > 0, `${path.relative(ROOT, f)} has imports the scan can see`);
    for (const spec of imports) {
      assert.ok(spec === "zod" || spec.startsWith("../lib/"), `${path.relative(ROOT, f)} imports ${spec}`);
    }
  }
});

test("the reviewer desk is never part of the tool context", async () => {
  const { buildRuntime } = await import("../src/server.js");
  const runtime = buildRuntime();
  assert.deepEqual(Object.keys(runtime.ctx).sort(), ["buckets", "defaultBucket", "memory", "records"]);
  for (const lib of [runtime.ctx.records, runtime.ctx.memory]) {
    for (const name of Object.keys(lib)) assert.ok(!/approve|reject|retract|review|purge/i.test(name), name);
  }
});

test("no source file references service-role or secret keys", () => {
  for (const f of SOURCE) {
    const text = readFileSync(f, "utf8");
    assert.ok(!/SERVICE_ROLE_KEY|serviceRole|sb_secret_[A-Za-z0-9]/.test(text), path.relative(ROOT, f));
  }
});

test("lib modules never construct their own store", () => {
  for (const f of files(path.join(ROOT, "src/lib"))) {
    assert.ok(!/new MemoryStore|createGuardedStore/.test(readFileSync(f, "utf8")), path.relative(ROOT, f));
  }
});
