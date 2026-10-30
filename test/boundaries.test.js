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

const SOURCE = [...files(path.join(ROOT, "src")), ...files(path.join(ROOT, "web")), ...files(path.join(ROOT, "scripts"))];

test("only src/server.js and src/store/ import the raw memory store", () => {
  const importers = SOURCE.filter((f) => /from\s+"[^"]*memory-store\.js"/.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
  assert.deepEqual(importers.filter((f) => !f.startsWith("src/store/")), ["src/server.js"]);
});

test("tools import nothing that can write to a store", () => {
  for (const f of files(path.join(ROOT, "src/tools"))) {
    const imports = [...readFileSync(f, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(spec === "zod" || spec.startsWith("../lib/"), `${path.relative(ROOT, f)} imports ${spec}`);
    }
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
