// guarded-store.js: the only store object tools and seeding ever see.
//
// Built mechanically from the raw store's method classification:
//   - read methods pass through unchanged
//   - write methods screen ALL of their arguments with the gate first; on any
//     violation they record a value-free audit entry and throw ScreeningError
//     without calling the raw method
//   - any raw method that is not classified as read or write makes
//     createGuardedStore throw, so the server cannot start with it
//
// Because screening keys off the argument list rather than a per-tool field
// list, a tool cannot forget to screen a field: every byte it hands to a
// write method goes through the same `gate.screen()` call.

import { ScreeningError } from "../screening/screen.js";

function ownMethodNames(obj) {
  const names = new Set();
  for (let proto = Object.getPrototypeOf(obj); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name !== "constructor" && typeof proto[name] === "function") names.add(name);
    }
  }
  for (const name of Object.keys(obj)) {
    if (typeof obj[name] === "function") names.add(name);
  }
  return [...names];
}

/**
 * @param {object} rawStore  store instance
 * @param {{screen: Function}} gate  from createGate()
 * @param {{reads: string[], writes: string[]}} classification
 */
export function createGuardedStore(rawStore, gate, { reads, writes }) {
  if (!gate || typeof gate.screen !== "function") {
    throw new Error("guarded store needs a screening gate");
  }
  const readSet = new Set(reads);
  const writeSet = new Set(writes);
  for (const name of readSet) {
    if (writeSet.has(name)) throw new Error(`store method "${name}" is classified as both read and write`);
  }
  const methods = ownMethodNames(rawStore);
  const unclassified = methods.filter((name) => !readSet.has(name) && !writeSet.has(name));
  if (unclassified.length) {
    throw new Error(`store methods not classified as read or write: ${unclassified.join(", ")}`);
  }
  for (const name of [...readSet, ...writeSet]) {
    if (typeof rawStore[name] !== "function") throw new Error(`store has no method "${name}"`);
  }

  const auditBlocked = (op, verdict) => {
    // Value-free by construction: op name, pattern ids and a count. No field
    // values, no paths, no excerpts. Screened too, so even this entry cannot
    // carry something the gate would reject.
    const entry = {
      op: "screen_blocked",
      target: op,
      pattern_ids: [...new Set(verdict.violations.map((v) => v.patternId))],
      violation_count: verdict.violations.length,
    };
    if (gate.screen(entry).ok) rawStore.appendAudit(entry);
  };

  // Args are screened as one array, so field paths start with "[n]". Turn
  // "[0].text" into "text" and "[1]" into "argument 2" for readable errors.
  const readable = (verdict) => ({
    ok: false,
    violations: verdict.violations.map((v) => {
      const m = /^\[(\d+)\]\.?(.*)$/.exec(v.field);
      if (!m) return v;
      const arg = `argument ${Number(m[1]) + 1}`;
      return { ...v, field: !m[2] ? arg : m[2].startsWith("[") ? `${arg}${m[2]}` : m[2] };
    }),
  });

  const guarded = {};
  for (const name of readSet) {
    guarded[name] = (...args) => rawStore[name](...args);
  }
  for (const name of writeSet) {
    guarded[name] = (...args) => {
      const verdict = gate.screen(args);
      if (!verdict.ok) {
        auditBlocked(name, verdict);
        throw new ScreeningError(readable(verdict), name);
      }
      return rawStore[name](...args);
    };
  }
  // Lets tests and startup checks confirm what they were handed.
  Object.defineProperty(guarded, "isGuarded", { value: true });
  return Object.freeze(guarded);
}
