import test from "node:test";
import assert from "node:assert/strict";

import { validateMemoryPath, MemoryPathError } from "../src/lib/memory-path.js";
import { newRuntime, SAMPLES } from "./_helpers.js";

function mem() {
  const runtime = newRuntime();
  return { m: runtime.ctx.memory, runtime };
}

test("path validation accepts canonical paths", () => {
  assert.deepEqual(validateMemoryPath("/memories"), { canonical: "/memories", subPath: "", isRoot: true });
  assert.deepEqual(validateMemoryPath("/memories/a/b.md"), { canonical: "/memories/a/b.md", subPath: "/a/b.md", isRoot: false });
});

test("path validation rejects traversal, control characters and non-canonical forms", () => {
  for (const bad of ["", "/etc/passwd", "/memoriesx/a", "/memories/../x", "/memories/a/%2e%2e/b", "/memories/a//b", "/memories/a/", "/memories/.hidden", "/memories/a\u0000b", `/memories/${"a".repeat(1100)}`]) {
    assert.throws(() => validateMemoryPath(bad), MemoryPathError, JSON.stringify(bad));
  }
  assert.throws(() => validateMemoryPath("/memories", { allowRoot: false }), MemoryPathError);
});

test("create, view, str_replace, insert", () => {
  const { m } = mem();
  assert.match(m.create({ path: "/memories/n/a.md", file_text: "one\ntwo\nthree" }), /created/);
  assert.match(m.view({ path: "/memories/n/a.md" }), /1\tone\n\s+2\ttwo/);
  assert.match(m.view({ path: "/memories/n/a.md", view_range: [2, 2] }), /2\ttwo$/);
  assert.match(m.str_replace({ path: "/memories/n/a.md", old_str: "two", new_str: "TWO" }), /edited/);
  assert.match(m.insert({ path: "/memories/n/a.md", insert_line: 0, insert_text: "zero\n" }), /edited/);
  assert.match(m.view({ path: "/memories/n/a.md" }), /1\tzero\n\s+2\tone\n\s+3\tTWO/);
});

test("str_replace refuses missing or ambiguous old_str", () => {
  const { m } = mem();
  m.create({ path: "/memories/n/a.md", file_text: "x\nx" });
  assert.match(m.str_replace({ path: "/memories/n/a.md", old_str: "y", new_str: "z" }), /did not appear/);
  assert.match(m.str_replace({ path: "/memories/n/a.md", old_str: "x", new_str: "z" }), /lines: 1, 2/);
});

test("str_replace treats $ in new_str literally", () => {
  const { m } = mem();
  m.create({ path: "/memories/n/a.md", file_text: "price" });
  m.str_replace({ path: "/memories/n/a.md", old_str: "price", new_str: "$& $1 $$" });
  assert.match(m.view({ path: "/memories/n/a.md" }), /\$& \$1 \$\$/);
});

test("insert rejects out-of-range lines", () => {
  const { m } = mem();
  m.create({ path: "/memories/n/a.md", file_text: "a" });
  assert.match(m.insert({ path: "/memories/n/a.md", insert_line: 5, insert_text: "b" }), /^Error: Invalid insert_line/);
});

test("directory listing, delete and rename", () => {
  const { m, runtime } = mem();
  m.create({ path: "/memories/d/a.md", file_text: "a" });
  m.create({ path: "/memories/d/b.md", file_text: "b" });
  assert.match(m.view({ path: "/memories" }), /\/memories\/d\/a\.md[\s\S]*\/memories\/d\/b\.md/);
  assert.match(m.rename({ old_path: "/memories/d", new_path: "/memories/e" }), /renamed/);
  assert.deepEqual(runtime.snapshot().files.map((f) => f.path).sort(), ["/e/a.md", "/e/b.md"]);
  assert.match(m.rename({ old_path: "/memories/e/a.md", new_path: "/memories/e/b.md" }), /already exists/);
  assert.match(m.rename({ old_path: "/memories/e", new_path: "/memories/e/inner" }), /inside itself/);
  assert.match(m.delete({ path: "/memories/e" }), /deleted/);
  assert.equal(runtime.snapshot().files.length, 0);
  assert.match(m.delete({ path: "/memories/e" }), /does not exist/);
});

test("a deny-listed edit leaves the file exactly as it was", () => {
  const { m, runtime } = mem();
  m.create({ path: "/memories/n/a.md", file_text: "contact: TBD" });
  const before = runtime.snapshot().files;
  const out = m.str_replace({ path: "/memories/n/a.md", old_str: "TBD", new_str: SAMPLES["email-address"] });
  assert.match(out, /^Error: putFile rejected by screening/);
  assert.deepEqual(runtime.snapshot().files, before);
});

test("blocked writes leave a value-free audit entry", () => {
  const { m, runtime } = mem();
  m.create({ path: `/memories/n/${SAMPLES["us-phone-number"]}.md`, file_text: `call ${SAMPLES["us-phone-number"]} after lunch` });
  const audit = runtime.snapshot().audit;
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0].pattern_ids, ["us-phone-number"]);
  assert.ok(!JSON.stringify(audit).includes("lunch"), "no surrounding context is stored");
  assert.ok(!JSON.stringify(audit).includes("/n/"), "no path is stored");
});
