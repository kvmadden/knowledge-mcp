import test from "node:test";
import assert from "node:assert/strict";

import { compileDenyList, createGate, LIMITS, ScreeningError } from "../src/screening/screen.js";
import { loadGate } from "../src/screening/load-deny-list.js";
import { SAMPLES } from "./_helpers.js";

const gate = loadGate();

test("the example list compiles and covers every sample pattern", () => {
  assert.deepEqual([...gate.patternIds].sort(), Object.keys(SAMPLES).sort());
});

for (const [id, sample] of Object.entries(SAMPLES)) {
  test(`pattern ${id} matches its synthetic sample, alone and inside prose`, () => {
    for (const value of [sample, `Note for later: ${sample}, thanks.`]) {
      const verdict = gate.screen({ text: value });
      assert.equal(verdict.ok, false);
      assert.ok(verdict.violations.some((v) => v.patternId === id && v.field === "text"));
    }
  });
}

test("benign text passes", () => {
  for (const value of [
    "Plan the sprint review for Thursday.",
    "Version 2.14.3 shipped; 42 tests pass.",
    "Ratio was 3-2 in the second run.",
    "Ticket 12345 is closed.",
    "2026-10-30T12:00:00.000Z",
    "rec_0001",
    "/memories/notes/a.md",
    "https://example.org/articles/retrieval-evaluation",
  ]) {
    assert.deepEqual(gate.screen({ text: value }), { ok: true }, value);
  }
});

test("verdicts carry field paths and pattern ids, never the matched text", () => {
  const verdict = gate.screen({ meta: { contacts: ["ok", SAMPLES["email-address"]] } });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.violations, [{ field: "meta.contacts[1]", patternId: "email-address" }]);
  assert.ok(!JSON.stringify(verdict).includes("jordan"));
  const err = new ScreeningError(verdict, "insertRecord");
  assert.ok(!err.message.includes("jordan"));
});

test("object keys are screened, not just values", () => {
  const verdict = gate.screen({ [SAMPLES["email-address"]]: true });
  assert.equal(verdict.ok, false);
  assert.match(verdict.violations[0].field, /\(key\)$/);
});

test("numbers are screened as text", () => {
  assert.equal(gate.screen({ card: 4111111111111111 }).ok, false);
  assert.equal(gate.screen({ count: 42 }).ok, true);
});

test("invisible characters and full-width digits do not slip past", () => {
  const zeroWidth = "jordan.sample​@example.com";
  const softHyphen = "555-010-­0199";
  const fullWidth = "５５５-０１０-０１９９";
  for (const value of [zeroWidth, softHyphen, fullWidth]) {
    assert.equal(gate.screen({ text: value }).ok, false, JSON.stringify(value));
  }
});

test("fails closed on values it cannot read", () => {
  const circular = { a: 1 };
  circular.self = circular;
  const throwing = {};
  Object.defineProperty(throwing, "text", { enumerable: true, get() { throw new Error("boom"); } });
  const cases = [
    [() => {}, "unsupported-type"],
    [Symbol("x"), "unsupported-type"],
    [10n, "unsupported-type"],
    [new Date(), "unsupported-type"],
    [new Map(), "unsupported-type"],
    [{ [Symbol("k")]: "v" }, "unsupported-type"],
    [Number.NaN, "non-finite-number"],
    [circular, "circular"],
    [throwing, "screen-error"],
  ];
  for (const [value, code] of cases) {
    const verdict = gate.screen(value);
    assert.equal(verdict.ok, false, String(code));
    assert.equal(verdict.violations[0].patternId, code);
  }
});

test("fails closed on oversized or over-deep input", () => {
  let deep = "x";
  for (let i = 0; i <= LIMITS.maxDepth + 1; i += 1) deep = [deep];
  assert.equal(gate.screen(deep).violations[0].patternId, "too-deep");
  assert.equal(gate.screen("a".repeat(LIMITS.maxTotalChars + 1)).violations[0].patternId, "too-large");
  assert.equal(gate.screen(Array.from({ length: LIMITS.maxStrings + 1 }, () => "a")).violations[0].patternId, "too-large");
});

test("the same array may appear twice without being called circular", () => {
  const shared = ["a"];
  assert.equal(gate.screen({ x: shared, y: shared }).ok, true);
});

test("a deny-list that is missing, empty or invalid cannot produce a gate", () => {
  const bad = [
    undefined,
    null,
    [],
    { patterns: [] },
    [{ id: "x" }],
    [{ id: "Bad Id", pattern: "a" }],
    [{ id: "a", pattern: "(" }],
    [{ id: "a", pattern: "a", flags: "g" }],
    [{ id: "a", pattern: "a" }, { id: "a", pattern: "b" }],
    [{ id: "empty-match", pattern: "x*" }],
  ];
  for (const list of bad) {
    assert.throws(() => compileDenyList(list), undefined, JSON.stringify(list));
    assert.throws(() => createGate(list));
  }
});

test("a custom list replaces the example list entirely", () => {
  const custom = createGate([{ id: "project-codename", pattern: "\\bbluebird\\b", flags: "i" }]);
  assert.equal(custom.screen({ text: "Project Bluebird kickoff" }).ok, false);
  assert.equal(custom.screen({ text: SAMPLES["email-address"] }).ok, true);
});

test("the gate object is frozen", () => {
  assert.ok(Object.isFrozen(gate));
  assert.throws(() => { gate.screen = () => ({ ok: true }); });
});
