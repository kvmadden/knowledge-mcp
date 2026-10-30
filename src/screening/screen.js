// screen.js: the one screening function every write path goes through.
//
// Pure ES module with no Node imports, so the browser write client uses this
// exact file. The server never writes to its store without calling
// `gate.screen()` first (see src/store/guarded-store.js), and the browser
// client never inserts a row without calling it either (see web/client.js).
//
// Fail-closed contract:
//   - A deny-list that is missing, empty, or has any invalid entry cannot be
//     compiled. `compileDenyList` throws, so no gate exists and nothing writes.
//   - `screen()` returns { ok: true } only when it walked every string in the
//     value (object keys included) and none matched. Any other outcome,
//     including an exception while walking or matching, is { ok: false }.
//   - Rejection is the only outcome. There is no "mask and write anyway" mode.
//   - Verdicts name the field path and the pattern id. They never contain the
//     matched text, so a rejection can be logged without copying the value.

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ALLOWED_FLAGS = new Set(["i", "m", "s", "u"]);

export const LIMITS = Object.freeze({
  maxDepth: 32,
  maxStrings: 10_000,
  maxTotalChars: 1_000_000,
});

// Zero-width and other invisible format characters (Unicode category Cf),
// plus soft hyphen. Stripped before matching so "a​@b.co" still matches.
const INVISIBLE_RE = /[\p{Cf}­]/gu;

export class ScreeningError extends Error {
  constructor(verdict, op = "write") {
    const first = verdict.violations[0];
    const where = first ? `field "${first.field}" matched "${first.patternId}"` : "screening failed";
    super(`${op} rejected by screening: ${where}`);
    this.name = "ScreeningError";
    this.op = op;
    this.violations = verdict.violations.map((v) => ({ ...v }));
  }
}

/**
 * Validate and compile a deny-list. Throws on anything it cannot use.
 * Accepts either { patterns: [...] } or a bare array of entries.
 */
export function compileDenyList(list) {
  const entries = Array.isArray(list) ? list : list?.patterns;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("deny-list must contain at least one pattern");
  }
  const seen = new Set();
  const compiled = entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`deny-list entry ${index} must be an object`);
    }
    const { id, pattern, flags = "" } = entry;
    if (typeof id !== "string" || !ID_RE.test(id)) {
      throw new Error(`deny-list entry ${index} needs a lowercase kebab-case id`);
    }
    if (seen.has(id)) throw new Error(`deny-list id "${id}" is duplicated`);
    seen.add(id);
    if (typeof pattern !== "string" || pattern.length === 0) {
      throw new Error(`deny-list entry "${id}" needs a non-empty pattern`);
    }
    if (typeof flags !== "string" || [...flags].some((f) => !ALLOWED_FLAGS.has(f))) {
      throw new Error(`deny-list entry "${id}" has unsupported flags "${flags}"`);
    }
    let re;
    try {
      // No "g" or "y": stateful lastIndex would make .test() order-dependent.
      re = new RegExp(pattern, flags);
    } catch (error) {
      throw new Error(`deny-list entry "${id}" is not a valid regular expression`, { cause: error });
    }
    if (re.test("")) throw new Error(`deny-list entry "${id}" matches the empty string`);
    return Object.freeze({ id, re });
  });
  return Object.freeze(compiled);
}

/**
 * Build a gate from a deny-list. The returned object is frozen; its only
 * behavior is `screen(value)`.
 */
export function createGate(list) {
  const compiled = compileDenyList(list);
  const patternIds = Object.freeze(compiled.map((p) => p.id));

  function screen(value) {
    try {
      const violations = [];
      const budget = { strings: 0, chars: 0 };
      walk(value, "", 0, new WeakSet(), budget, (field, text) => {
        const variants = matchVariants(text);
        for (const { id, re } of compiled) {
          if (variants.some((v) => re.test(v))) violations.push({ field: field || "(value)", patternId: id });
        }
      });
      if (violations.length) return { ok: false, violations };
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        violations: [{ field: error?.field || "(value)", patternId: error?.screenCode || "screen-error" }],
      };
    }
  }

  return Object.freeze({ screen, patternIds });
}

function matchVariants(text) {
  const normalized = text.normalize("NFKC").replace(INVISIBLE_RE, "");
  return normalized === text ? [text] : [text, normalized];
}

function fail(code, field) {
  const error = new Error(code);
  error.screenCode = code;
  error.field = field || "(value)";
  return error;
}

function joinKey(base, key) {
  return base ? `${base}.${key}` : key;
}

// Walks plain data only: strings, finite numbers, booleans, null, undefined,
// arrays and plain objects. Anything else (functions, symbols, bigint, class
// instances, Maps, Dates) is rejected rather than skipped, because a value the
// gate cannot read is a value it cannot vouch for.
function walk(value, field, depth, seen, budget, visitString) {
  if (depth > LIMITS.maxDepth) throw fail("too-deep", field);
  if (value === null || value === undefined) return;
  const type = typeof value;
  if (type === "string") {
    budget.strings += 1;
    budget.chars += value.length;
    if (budget.strings > LIMITS.maxStrings || budget.chars > LIMITS.maxTotalChars) {
      throw fail("too-large", field);
    }
    visitString(field, value);
    return;
  }
  if (type === "boolean") return;
  if (type === "number") {
    if (!Number.isFinite(value)) throw fail("non-finite-number", field);
    // Numbers are screened as their decimal text so a phone or card number
    // passed as a number is still caught.
    visitString(field, String(value));
    return;
  }
  if (type !== "object") throw fail("unsupported-type", field);
  if (seen.has(value)) throw fail("circular", field);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walk(value[i], `${field}[${i}]`, depth + 1, seen, budget, visitString);
    }
    seen.delete(value);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw fail("unsupported-type", field);
  if (Object.getOwnPropertySymbols(value).length) throw fail("unsupported-type", field);
  for (const key of Object.keys(value)) {
    const keyField = joinKey(field, key);
    visitString(`${keyField} (key)`, key);
    walk(value[key], keyField, depth + 1, seen, budget, visitString);
  }
  seen.delete(value);
}
