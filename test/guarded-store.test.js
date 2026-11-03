import test from "node:test";
import assert from "node:assert/strict";

import { CLASSIFICATION, INTERNAL_METHODS, MemoryStore, READ_METHODS, SCREENED_ARGS, WRITE_METHODS } from "../src/store/memory-store.js";
import { createGuardedStore, createWriteGuard } from "../src/store/guarded-store.js";
import { loadGate } from "../src/screening/load-deny-list.js";
import { ScreeningError } from "../src/screening/screen.js";
import { SAMPLES } from "./_helpers.js";

const gate = loadGate();
const classes = { ...CLASSIFICATION, screenedArgs: SCREENED_ARGS };

test("every raw store method is classified exactly once", () => {
  const methods = Object.getOwnPropertyNames(MemoryStore.prototype).filter((n) => n !== "constructor");
  assert.deepEqual([...READ_METHODS, ...WRITE_METHODS, ...INTERNAL_METHODS].sort(), methods.sort());
  const all = [...READ_METHODS, ...WRITE_METHODS, ...INTERNAL_METHODS];
  assert.equal(new Set(all).size, all.length);
});

test("an unclassified method stops the guarded store from being built", () => {
  class Extended extends MemoryStore {
    sneakyWrite() {}
  }
  assert.throws(() => createGuardedStore(new Extended(), gate, classes), /not classified.*sneakyWrite/);
});

test("a method classified as both read and write is refused", () => {
  assert.throws(
    () => createGuardedStore(new MemoryStore(), gate, { ...classes, reads: [...READ_METHODS, "insertRecord"] }),
    /both read and write/,
  );
});

test("no gate, no store", () => {
  assert.throws(() => createGuardedStore(new MemoryStore(), null, classes));
  assert.throws(() => createGuardedStore(new MemoryStore(), {}, classes));
});

test("the guarded store is frozen and exposes only read and write methods, never internal ones", () => {
  const store = createGuardedStore(new MemoryStore(), gate, classes);
  assert.ok(Object.isFrozen(store));
  assert.deepEqual(Object.keys(store).sort(), [...READ_METHODS, ...WRITE_METHODS].sort());
  for (const name of INTERNAL_METHODS) assert.equal(store[name], undefined, name);
  assert.equal(store.isGuarded, true);
});

// Arguments that would succeed with benign content, per content-bearing write
// method. deleteFiles is covered separately: deletion adds no content, so its
// locators are not content-screened.
const WRITE_CALLS = {
  insertRecord: (s) => [{ owner_id: "o", text: s, source_app: "t", tags: [], meta: {} }],
  updateRecordMeta: (s) => ["o", "rec_0001", { note: s }],
  putFile: (s) => ["o", `/notes/${s}.md`, "body"],
  moveFiles: (s) => ["o", [["/notes/a.md", `/notes/${s}.md`]]],
};

test("WRITE_CALLS covers every content-bearing write method", () => {
  assert.deepEqual(Object.keys(WRITE_CALLS).sort(), WRITE_METHODS.filter((m) => m !== "deleteFiles").sort());
});

test("deletion locators are not content-screened: a matching path can be removed, and its audit entry stores no path", () => {
  for (const sample of Object.values(SAMPLES)) {
    const raw = new MemoryStore();
    raw.putFile("o", `/notes/${sample}.md`, "contaminated before a policy change");
    const store = createGuardedStore(raw, gate, classes);
    assert.equal(store.deleteFiles("o", [`/notes/${sample}.md`]), 1);
    const after = raw.snapshot();
    assert.equal(after.files.length, 0);
    assert.ok(!JSON.stringify(after).includes(sample), "nothing of the path remains, audit included");
    assert.deepEqual(after.audit.at(-1).op, "write_allowed");
    assert.equal(after.audit.at(-1).payload_sha256, undefined);
  }
});

test("a move screens its destination but not its source", () => {
  const raw = new MemoryStore();
  raw.putFile("o", `/notes/${SAMPLES["email-address"]}.md`, "x");
  const store = createGuardedStore(raw, gate, classes);
  assert.equal(store.moveFiles("o", [[`/notes/${SAMPLES["email-address"]}.md`, "/notes/clean.md"]]), 1);
  assert.throws(() => store.moveFiles("o", [["/notes/clean.md", `/notes/${SAMPLES["us-phone-number"]}.md`]]), ScreeningError);
  assert.deepEqual(raw.snapshot().files.map((f) => f.path), ["/notes/clean.md"]);
});

for (const method of Object.keys(WRITE_CALLS)) {
  test(`${method}: a deny-listed argument throws ScreeningError and writes nothing`, () => {
    for (const sample of Object.values(SAMPLES)) {
      const raw = new MemoryStore();
      raw.insertRecord({ owner_id: "o", text: "seed", source_app: "t" });
      raw.putFile("o", "/notes/a.md", "seed");
      const store = createGuardedStore(raw, gate, classes);
      const before = raw.snapshot();
      assert.throws(() => store[method](...WRITE_CALLS[method](sample)), ScreeningError);
      const after = raw.snapshot();
      assert.deepEqual({ records: after.records, files: after.files }, { records: before.records, files: before.files });
      assert.ok(!JSON.stringify(after).includes(sample), "sample absent from store, audit included");
      const last = after.audit.at(-1);
      assert.equal(last.op, "screen_blocked");
      assert.equal(last.target, method);
      assert.deepEqual(Object.keys(last).sort(), ["at", "op", "pattern_ids", "policy", "review_ids", "target", "violation_count"]);
    }
  });
}

test("benign writes go through", () => {
  const raw = new MemoryStore();
  const store = createGuardedStore(raw, gate, classes);
  const row = store.insertRecord({ owner_id: "o", text: "hello", source_app: "t" });
  assert.equal(row.id, "rec_0001");
  store.putFile("o", "/notes/a.md", "body");
  assert.equal(raw.snapshot().files.length, 1);
});
