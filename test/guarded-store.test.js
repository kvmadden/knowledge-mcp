import test from "node:test";
import assert from "node:assert/strict";

import { MemoryStore, READ_METHODS, WRITE_METHODS } from "../src/store/memory-store.js";
import { createGuardedStore } from "../src/store/guarded-store.js";
import { loadGate } from "../src/screening/load-deny-list.js";
import { ScreeningError } from "../src/screening/screen.js";
import { SAMPLES } from "./_helpers.js";

const gate = loadGate();
const classes = { reads: READ_METHODS, writes: WRITE_METHODS };

test("every raw store method is classified exactly once", () => {
  const methods = Object.getOwnPropertyNames(MemoryStore.prototype).filter((n) => n !== "constructor");
  assert.deepEqual([...READ_METHODS, ...WRITE_METHODS].sort(), methods.sort());
  assert.equal(READ_METHODS.filter((m) => WRITE_METHODS.includes(m)).length, 0);
});

test("an unclassified method stops the guarded store from being built", () => {
  class Extended extends MemoryStore {
    sneakyWrite() {}
  }
  assert.throws(() => createGuardedStore(new Extended(), gate, classes), /not classified.*sneakyWrite/);
});

test("a method classified as both read and write is refused", () => {
  assert.throws(
    () => createGuardedStore(new MemoryStore(), gate, { reads: [...READ_METHODS, "insertRecord"], writes: WRITE_METHODS }),
    /both read and write/,
  );
});

test("no gate, no store", () => {
  assert.throws(() => createGuardedStore(new MemoryStore(), null, classes));
  assert.throws(() => createGuardedStore(new MemoryStore(), {}, classes));
});

test("the guarded store is frozen and exposes only classified methods", () => {
  const store = createGuardedStore(new MemoryStore(), gate, classes);
  assert.ok(Object.isFrozen(store));
  assert.deepEqual(Object.keys(store).sort(), [...READ_METHODS, ...WRITE_METHODS].sort());
  assert.equal(store.isGuarded, true);
});

// Arguments that would succeed with benign content, per write method.
const WRITE_CALLS = {
  insertRecord: (s) => [{ owner_id: "o", text: s, source_app: "t", tags: [], meta: {} }],
  updateRecordMeta: (s) => ["o", "rec_0001", { note: s }],
  putFile: (s) => ["o", `/notes/${s}.md`, "body", 1],
  deleteFiles: (s) => ["o", [`/notes/${s}.md`]],
  moveFiles: (s) => ["o", [["/notes/a.md", `/notes/${s}.md`]]],
  appendAudit: (s) => [{ op: "x", path: s }],
};

test("WRITE_CALLS covers every write method", () => {
  assert.deepEqual(Object.keys(WRITE_CALLS).sort(), [...WRITE_METHODS].sort());
});

for (const method of WRITE_METHODS) {
  test(`${method}: a deny-listed argument throws ScreeningError and writes nothing`, () => {
    for (const sample of Object.values(SAMPLES)) {
      const raw = new MemoryStore();
      raw.insertRecord({ owner_id: "o", text: "seed", source_app: "t" });
      raw.putFile("o", "/notes/a.md", "seed", 1);
      const store = createGuardedStore(raw, gate, classes);
      const before = raw.snapshot();
      assert.throws(() => store[method](...WRITE_CALLS[method](sample)), ScreeningError);
      const after = raw.snapshot();
      assert.deepEqual({ records: after.records, files: after.files }, { records: before.records, files: before.files });
      assert.ok(!JSON.stringify(after).includes(sample), "sample absent from store, audit included");
      const last = after.audit.at(-1);
      assert.equal(last.op, "screen_blocked");
      assert.equal(last.target, method);
      assert.deepEqual(Object.keys(last).sort(), ["at", "op", "pattern_ids", "target", "violation_count"]);
    }
  });
}

test("benign writes go through", () => {
  const raw = new MemoryStore();
  const store = createGuardedStore(raw, gate, classes);
  const row = store.insertRecord({ owner_id: "o", text: "hello", source_app: "t" });
  assert.equal(row.id, "rec_0001");
  store.putFile("o", "/notes/a.md", "body", 1);
  assert.equal(raw.snapshot().files.length, 1);
});
