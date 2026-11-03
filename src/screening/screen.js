// screen.js: the one screening function every write path goes through.
//
// Pure ES module with no Node imports, so the browser write client uses this
// exact file. The server never writes to its store without calling
// `gate.screen()` first (see src/store/guarded-store.js), and the browser
// client never inserts a row without calling it either (see web/client.js).
//
// A verdict has one of three decisions:
//   block   A listed pattern or a block-tier policy rule matched, or the input
//           could not be read in full (too large, too deep, an unsupported
//           type). Nothing is written.
//   review  Nothing listed matched, but part of the input is something this
//           gate cannot judge: an instruction aimed at an AI, a clinical rule
//           or dose claim, an untrusted source, encoded content it could not
//           decode, a word that mixes Latin and Cyrillic letters. The write
//           is held for a person.
//   allow   No listed pattern or policy rule was found, and every string and
//           key in the input was read, with every encoded layer the gate
//           decodes. This is a statement about the listed rules only. It
//           does not mean the content is safe, true or free of personal
//           information that no rule describes.
//
// Matching runs on several readings of each string and object key: as
// written, after compatibility folding (NFKC, invisible characters and
// combining marks removed, dashes and non-ASCII digits folded, common
// Cyrillic and Greek look-alike letters mapped to Latin), after decoding
// base64, hex, percent and HTML-entity encoded segments up to three layers
// deep, and on the values of one write joined together.
//
// Verdicts name the field path and the rule id. They never contain matched
// text, and an object key that is not a plain identifier is reported by its
// position, never by its text.

export const POLICY_VERSION = '2'

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const ALLOWED_FLAGS = new Set(['i', 'm', 's', 'u'])
const ACTIONS = new Set(['block', 'review'])
const SAFE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/

export const LIMITS = Object.freeze({
  maxDepth: 32,
  maxStrings: 10_000,
  maxNodes: 100_000,
  maxTotalChars: 1_000_000,
})

// ── errors ──────────────────────────────────────────────────────────────

function describe(v) {
  if (v.kind === 'unreadable') return `field "${v.field}" could not be screened ("${v.patternId}")`
  return `field "${v.field}" matched "${v.patternId}"${v.encoding ? ` after ${v.encoding} decoding` : ''}`
}

export class ScreeningError extends Error {
  constructor(verdict, op = 'write') {
    const first = verdict.violations?.[0]
    super(`${op} rejected by screening: ${first ? describe(first) : 'screening failed'}`)
    this.name = 'ScreeningError'
    this.op = op
    this.violations = (verdict.violations ?? []).map((v) => ({ ...v }))
    this.reviews = (verdict.reviews ?? []).map((r) => ({ ...r }))
  }
}

export class ReviewRequiredError extends Error {
  constructor(verdict, op = 'write', holdId = null) {
    const ids = [...new Set((verdict.reviews ?? []).map((r) => r.reasonId))]
    const where = verdict.reviews?.[0]?.field
    super(
      `${op} held for review: ${ids.map((id) => `"${id}"`).join(', ') || 'needs review'}${where ? ` (field "${where}")` : ''}. ` +
        `Nothing was written.${holdId ? ` Hold id ${holdId}.` : ''} A reviewer must approve or reject it outside MCP.`,
    )
    this.name = 'ReviewRequiredError'
    this.op = op
    this.holdId = holdId
    this.reviews = (verdict.reviews ?? []).map((r) => ({ ...r }))
  }
}

export class DeferredWriteError extends Error {
  constructor(op, verdict) {
    const ids = [...new Set((verdict?.reviews ?? []).map((r) => r.reasonId))]
    const finding = verdict?.decision === 'review'
      ? `it would be held for review (${ids.map((id) => `"${id}"`).join(', ')})`
      : 'no listed pattern was found'
    super(`${op} deferred by dry-run: ${finding}, no data written. Human review is required before resubmitting in commit mode.`)
    this.name = 'DeferredWriteError'
    this.op = op
    this.decision = verdict?.decision ?? 'allow'
    this.reviews = (verdict?.reviews ?? []).map((r) => ({ ...r }))
  }
}

// ── deny-list compilation ───────────────────────────────────────────────

function luhnValid(digits) {
  if (digits.length < 12) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888'])

// Named checks a deny-list entry can apply to each match. A match counts only
// when its check returns true.
export const VALIDATORS = Object.freeze({
  luhn: (match) => luhnValid(match.replace(/\D/g, '')),
  'not-us-toll-free': (match) => {
    const digits = match.replace(/\D/g, '')
    const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits
    return !TOLL_FREE.has(ten.slice(0, 3))
  },
})

// A validated pattern (a card number that must pass Luhn, a phone number
// that must not be toll-free) is tried at every start position, and each
// match is also tried with up to six trailing groups cut off, so digit
// groups glued to the front or back of a real number cannot hide it. Six is
// enough for any card: a match holds at most 19 digits and a card at least
// 13. The start
// moves forward on every try, so there are at most as many tries as
// characters. Each try costs one match of a bounded pattern, which keeps the
// loop linear. A pattern whose matches are unbounded would make it quadratic:
// compileDenyList times this loop at startup and refuses such a pattern.
function matchCompiled(p, text) {
  if (!p.check) return p.re.test(text)
  let start = 0
  while (start <= text.length) {
    p.all.lastIndex = start
    const m = p.all.exec(text)
    if (!m) return false
    const s = m[0]
    if (p.check(s)) return true
    // Cut off trailing groups, one at a time, up to six.
    for (let cut = s.length - 1, tries = 0; cut > 0 && tries < 6; cut -= 1) {
      if (/[^0-9A-Za-z]/.test(s[cut]) && /[0-9A-Za-z]/.test(s[cut - 1])) {
        tries += 1
        const prefix = s.slice(0, cut)
        if (p.anchored.test(prefix) && p.check(prefix)) return true
      }
    }
    start = m.index + 1
  }
  return false
}

const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now())
const SPEED_LIMIT_MS = 40
const SPEED_CEILING_MS = 500
const speedVerdicts = new Map()

// A pattern that backtracks on long input can stall the whole server. Each
// pattern is timed once per process on long synthetic probes. It is refused
// when a 12,000-character probe is slow and took more than three times as
// long as a 6,000-character one (the time grew faster than the size), or when
// the larger probe is extremely slow. A busy host makes a linear pattern
// slower but not super-linear. A probe that looks slow is measured again, up
// to three times, and the pattern is refused only when every measurement
// looks slow: a pattern that backtracks is slow every time, a pause on a busy
// host is not. This is a backstop, not a proof that every input is fast.
function timedTwice(run) {
  let ms = run()
  if (ms > SPEED_LIMIT_MS / 4 && ms <= SPEED_CEILING_MS) ms = Math.min(ms, run(), run())
  return ms
}
function probeFailure(timeAt, make) {
  let last = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const large = timedTwice(() => timeAt(make(12_000)))
    if (large <= SPEED_LIMIT_MS) return null
    const small = large > SPEED_CEILING_MS ? null : timedTwice(() => timeAt(make(6_000)))
    if (small !== null && large / Math.max(small, 0.5) <= 3) return null
    last = { small, large }
    // Far past any pause: one confirming measurement is enough.
    if (large === Infinity || (attempt >= 1 && large > 4 * SPEED_CEILING_MS)) break
  }
  return last
}
export function speedFailure(label, timeAt, probes) {
  for (const make of probes) {
    const slow = probeFailure(timeAt, make)
    if (slow) {
      const large = Number.isFinite(slow.large) ? `${Math.round(slow.large)} ms on a 12,000-character probe` : 'the retry limit on a 12,000-character probe'
      const small = slow.small === null ? '' : `, ${Math.round(slow.small)} ms on 6,000`
      return `${label} is too slow on long input (${large}${small}). Bound its quantifiers or anchor it.`
    }
  }
  return null
}
const repeatTo = (unit) => (n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n)
const SPEED_PROBES = ['a', 'a.', 'a-', '1', '1 ', '1-', ' ', 'a@', 'aa@a.', 'A1._%+-', '(1', 'ab '].map(repeatTo)
const VALIDATED_PROBES = [(n) => '0'.repeat(n - 13) + '0000000000001', repeatTo('1234 '), repeatTo('1-'), repeatTo('a1')]

export function assertFastPattern(label, re) {
  const key = `${re.source}/${re.flags}`
  const known = speedVerdicts.get(key)
  if (known === true) return
  if (typeof known === 'string') throw new Error(known)
  const failure = speedFailure(label, (probe) => {
    const started = clock()
    re.lastIndex = 0
    re.test(probe)
    return clock() - started
  }, SPEED_PROBES)
  speedVerdicts.set(key, failure ?? true)
  if (failure) throw new Error(failure)
}

// A validated pattern is also timed through its retry loop, which can be slow
// even when a single test of the expression is fast.
function assertFastMatcher(label, entry) {
  const key = `${entry.source}/${entry.flags}/${entry.validate}`
  const known = speedVerdicts.get(key)
  if (known === true) return
  if (typeof known === 'string') throw new Error(known)
  const failure = speedFailure(`${label} with its validator`, (probe) => {
    const started = clock()
    try {
      matchCompiled(entry, probe)
    } catch {
      return Infinity
    }
    return clock() - started
  }, VALIDATED_PROBES)
  speedVerdicts.set(key, failure ?? true)
  if (failure) throw new Error(failure)
}

/**
 * Validate and compile a deny-list. Throws on anything it cannot use.
 * Accepts either { patterns: [...] } or a bare array of entries.
 * Entry fields: id, pattern, flags, optional validate (a VALIDATORS name) and
 * optional action ("block", the default, or "review").
 */
export function compileDenyList(list) {
  const entries = Array.isArray(list) ? list : list?.patterns
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('deny-list must contain at least one pattern')
  }
  const seen = new Set()
  const compiled = entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`deny-list entry ${index} must be an object`)
    }
    const { id, pattern, flags = '', validate, action = 'block' } = entry
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      throw new Error(`deny-list entry ${index} needs a lowercase kebab-case id`)
    }
    if (seen.has(id)) throw new Error(`deny-list id "${id}" is duplicated`)
    seen.add(id)
    if (typeof pattern !== 'string' || pattern.length === 0) {
      throw new Error(`deny-list entry "${id}" needs a non-empty pattern`)
    }
    if (typeof flags !== 'string' || [...flags].some((f) => !ALLOWED_FLAGS.has(f))) {
      throw new Error(`deny-list entry "${id}" has unsupported flags "${flags}"`)
    }
    if (validate !== undefined && !Object.hasOwn(VALIDATORS, validate)) {
      throw new Error(`deny-list entry "${id}" names an unknown validator "${validate}"`)
    }
    if (!ACTIONS.has(action)) throw new Error(`deny-list entry "${id}" has an unknown action "${action}"`)
    let re
    try {
      // No "g" or "y": stateful lastIndex would make .test() order-dependent.
      re = new RegExp(pattern, flags)
    } catch (error) {
      throw new Error(`deny-list entry "${id}" is not a valid regular expression`, { cause: error })
    }
    if (re.test('')) throw new Error(`deny-list entry "${id}" matches the empty string`)
    assertFastPattern(`deny-list entry "${id}"`, re)
    const all = validate ? new RegExp(pattern, `${flags}g`) : null
    const anchored = validate ? new RegExp(`^(?:${pattern})$`, flags) : null
    const compiledEntry = Object.freeze({ id, re, all, anchored, check: validate ? VALIDATORS[validate] : null, action, source: pattern, flags, validate: validate ?? null })
    // A validated pattern is also timed through its retry loop, which can be
    // slow even when one test of the expression is fast.
    if (validate) assertFastMatcher(`deny-list entry "${id}"`, compiledEntry)
    return compiledEntry
  })
  return Object.freeze(compiled)
}

// ── text normalization ──────────────────────────────────────────────────

const IGNORABLE_RE = /[\p{Default_Ignorable_Code_Point}\u2800]/gu
const DASH_RE = /[\p{Pd}\u2212\u2043]/gu
const NON_ASCII_RE = /[^\x00-\x7f]/

// Cyrillic, Greek and other letters that render like Latin letters. A subset
// of the Unicode confusables data, chosen for letters that appear in English
// words. Folding happens in a matching copy only, never in stored text.
const CONFUSABLES = new Map(Object.entries({
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', п: 'n', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  ѕ: 's', і: 'i', ї: 'i', ј: 'j', ԁ: 'd', ԛ: 'q', ԝ: 'w', һ: 'h', ӏ: 'l', ɡ: 'g', ı: 'i',
  А: 'A', В: 'B', Е: 'E', Ё: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  Ѕ: 'S', І: 'I', Ї: 'I', Ј: 'J', Ԁ: 'D', Ԛ: 'Q', Ԝ: 'W', Һ: 'H', Ӏ: 'I',
  α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ϲ: 'c', ϳ: 'j',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X', Ϲ: 'C',
  օ: 'o', ս: 'u',
}))
const CONFUSABLE_RE = new RegExp(`[${[...CONFUSABLES.keys()].join('')}]`, 'gu')
const DIGIT_RE = /\p{Nd}/u
const digitCache = new Map()

// Unicode decimal digits come in runs of ten, 0 to 9. A digit's value is its
// offset from the start of its run.
function digitValue(ch) {
  if (digitCache.has(ch)) return digitCache.get(ch)
  const cp = ch.codePointAt(0)
  let start = cp
  while (start > 0 && DIGIT_RE.test(String.fromCodePoint(start - 1))) start -= 1
  const value = String((cp - start) % 10)
  digitCache.set(ch, value)
  return value
}

/** The folded matching copy of one string. */
export function foldText(text) {
  let out = text.normalize('NFKC').replace(IGNORABLE_RE, '').replace(DASH_RE, '-')
  if (NON_ASCII_RE.test(out)) {
    // Combining marks are dropped from the matching copy, so "ign\u0301ore"
    // reads as "ignore". Stored text keeps them.
    out = out.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')
    out = out.replace(CONFUSABLE_RE, (ch) => CONFUSABLES.get(ch))
    out = out.replace(/\p{Nd}/gu, (ch) => (ch <= '9' ? ch : digitValue(ch)))
  }
  return out
}

const LETTER_SPACED_RE = /(?<![\p{L}\p{N}])(?:\p{L}[ \t.*_-]){2,}\p{L}(?![\p{L}\p{N}])/gu

// Lowercased copy for phrase rules: quotes straightened, whitespace runs
// collapsed, a single line break read as wrapping and a blank line as the end
// of a paragraph, letter-spaced words rejoined, separators between letters
// turned into spaces. Every pass is a single linear scan: an earlier version
// used one expression that backtracked over long runs of spaces.
function phraseOf(folded) {
  const squeezed = []
  const text = folded
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b\u2032`]/g, "'")
    .replace(/[\u201c\u201d\u201f\u2033\u00ab\u00bb]/g, '"')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\u2029')
    .replace(/\n/g, ' ')
    .replace(/\u2029/g, '\n')
    .replace(LETTER_SPACED_RE, (m) => {
      const joined = m.replace(/[ \t.*_-]/g, '')
      squeezed.push(joined)
      return joined
    })
    .replace(/(?<=\p{L})[-_*~+=|\\/]+(?=\p{L})/gu, ' ')
    .replace(/ {2,}/g, ' ')
  return { text, squeezed }
}

// ── decoding ────────────────────────────────────────────────────────────

const ENTITY_RE = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(lt|gt|amp|quot|apos|nbsp));/gi
const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' }
const PERCENT_RUN_RE = /(?:%[0-9a-f]{2})+/gi
const BASE64_RE = /[A-Za-z0-9+/]{16,}={0,2}|[A-Za-z0-9_-]{16,}/g
const HEX_RE = /(?<![0-9a-f])(?:[0-9a-f]{2}){8,}(?![0-9a-f])/gi
const ROT13_CUE_RE = /\b(?:rot-?13|caesar|rotate each letter)\b/i
const UNREADABLE_MIN = 256
// Short strings whose findings each gate keeps for reuse, and how many.
const CACHED_TEXT_MAX = 256
const CACHED_TEXTS = 5_000
// Characters of joined field text decoded per write, across every stretch tried.
const MAX_JOINED_DECODE = 1_000_000
const MAX_TOKENS = 256
const MAX_DEPTH = 3
const MAX_READINGS = 512

function fromCodePointSafe(cp) {
  return cp > 0x10ffff ? '' : String.fromCodePoint(cp)
}

function decodeEntities(text) {
  return text.replace(ENTITY_RE, (m, dec, hex, name) => {
    if (dec) return fromCodePointSafe(Number(dec))
    if (hex) return fromCodePointSafe(parseInt(hex, 16))
    return NAMED[name.toLowerCase()]
  })
}

function decodePercent(text) {
  return text.replace(PERCENT_RUN_RE, (run) => {
    try {
      return decodeURIComponent(run)
    } catch {
      return run
    }
  })
}

// Decoded bytes count as text only when they are valid UTF-8 and nearly all
// readable. Invalid UTF-8 decodes to U+FFFD here instead of throwing, which
// keeps rejecting random bytes cheap.
const UTF8 = new TextDecoder('utf-8')

function bytesToText(bytes) {
  const text = UTF8.decode(bytes)
  if (!text || text.includes('\uFFFD')) return null
  let readable = 0
  let total = 0
  for (const ch of text) {
    total += 1
    if (/[\p{L}\p{N}\p{P}\p{Zs}\n\t]/u.test(ch)) readable += 1
  }
  return readable / total >= 0.9 && /\p{L}{2}/u.test(text) ? text : null
}

function base64Bytes(token) {
  const std = token.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (std.length % 4 === 1) return null
  try {
    const bin = atob(std.padEnd(Math.ceil(std.length / 4) * 4, '='))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

function hexBytes(token) {
  const out = new Uint8Array(token.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(token.slice(i * 2, i * 2 + 2), 16)
  return out
}

function rot13(text) {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= 'Z' ? 65 : 97
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base)
  })
}

// Base64 or hex that was wrapped at a fixed width (several chunks of the same
// length on separate lines or after spaces, the last one shorter) is joined
// back into one token before decoding.
function wrappedTokens(text) {
  const out = []
  let run = []
  const flush = () => {
    if (run.length >= 2) {
      const width = run[0].length
      if (width >= 8 && run.slice(0, -1).every((t) => t.length === width) && run.at(-1).length <= width) out.push(run.join(''))
    }
    run = []
  }
  for (const part of text.split(/\s+/)) {
    if (/^[A-Za-z0-9+/_-]{4,}={0,2}$/.test(part)) run.push(part)
    else flush()
  }
  flush()
  return out
}

// Returns the readable texts hidden in encoded segments of one string, and
// whether part of it could not be read: a long encoded segment that is not
// text, more encoded tokens than the gate decodes, or encoding nested deeper
// than it unwraps. In each of those cases the caller must not report that
// nothing was found.
function decodedReadings(text, depth = 0, counter = { readings: 0 }, shallow = false) {
  const out = []
  let unreadable = false
  const push = (reading) => {
    if ((counter.readings += 1) > MAX_READINGS) unreadable = true
    else out.push(reading)
  }
  if (/&(?:#\d|#x[0-9a-f]|lt;|gt;|amp;|quot;|apos;|nbsp;)/i.test(text)) {
    const decoded = decodeEntities(text)
    if (decoded !== text) push({ via: 'html-entities', text: decoded })
  }
  if (/%[0-9a-f]{2}/i.test(text)) {
    const decoded = decodePercent(text)
    if (decoded !== text) push({ via: 'percent-encoding', text: decoded })
  }
  let tokens = 0
  const base64Candidates = [...[...text.matchAll(BASE64_RE)].map((m) => m[0]), ...wrappedTokens(text)]
  for (const token of base64Candidates) {
    if ((tokens += 1) > MAX_TOKENS) {
      unreadable = true
      break
    }
    if (/^[0-9a-f]+$/i.test(token) && token.length % 2 === 0) continue // left to the hex pass
    const bytes = base64Bytes(token)
    const decoded = bytes && bytesToText(bytes)
    if (decoded) push({ via: 'base64', text: decoded })
    else if (token.length >= UNREADABLE_MIN) unreadable = true
  }
  tokens = 0
  const hexCandidates = [...[...text.matchAll(HEX_RE)].map((m) => m[0]), ...wrappedTokens(text).filter((t) => /^(?:[0-9a-f]{2})+$/i.test(t))]
  for (const token of hexCandidates) {
    if ((tokens += 1) > MAX_TOKENS) {
      unreadable = true
      break
    }
    const decoded = bytesToText(hexBytes(token))
    if (decoded) push({ via: 'hex', text: decoded })
    else if (token.length >= UNREADABLE_MIN) unreadable = true
  }
  if (ROT13_CUE_RE.test(text)) push({ via: 'rot13', text: rot13(text) })
  if (shallow) return { readings: out, unreadable }
  for (const reading of [...out]) {
    if (depth + 1 >= MAX_DEPTH) {
      // One more layer could still hide text: refuse to call it read.
      if (decodedReadings(reading.text, depth + 1, { readings: 0 }, true).readings.some((r) => r.via !== 'rot13')) unreadable = true
      continue
    }
    const inner = decodedReadings(reading.text, depth + 1, counter)
    unreadable ||= inner.unreadable
    for (const r of inner.readings) push({ via: `${reading.via}+${r.via}`, text: r.text })
  }
  return { readings: out, unreadable }
}

// ── phrase rules ────────────────────────────────────────────────────────
//
// Each rule reads the lowercased phrase copy as a list of word tokens and
// classifies the clause around an override, export or decode verb:
//   directive    the verb starts the clause, after a greeting or only lead
//                words such as "please" or "you must": the rule applies
//   negated      a negation governs the verb ("never send", "do not ignore",
//                "not to forget"): a prohibition, nothing applies
//   description  a third party is the subject ("patients often ignore prior
//                instructions"): the override rule does not apply
//   quoted       the verb sits inside a closed quotation, or follows a cue such
//                as "says" or "quotes:": the write is held for review
//   uncertain    anything else: what would have been blocked is held instead
// No class turns a matched directive into an allow except negated and
// description, so an unknown lead word or a nearby disavowal can no longer
// let a full override or export through.

const TOKEN_RE = /[a-z0-9']+|[.!?;:,\n"]/g
const BOUNDARY = new Set(['.', '!', '?', ';', ':', ',', '\n', '"'])
const NEGATION = new Set(['not', 'never', "don't", 'dont', "doesn't", 'doesnt', "didn't", 'didnt', "won't", 'wont', "wouldn't", "can't", 'cant', 'cannot', "couldn't", "shouldn't", "mustn't", "shan't", 'nobody', 'neither', 'nor'])
// Words that may stand between a negation and the verb it governs.
const NEGATION_FILLER = new Set(['to', 'ever', 'even', 'just', 'simply', 'really', 'actually', 'be', 'please', 'you', 'we', 'agents'])
const GREETING = new Set(['hey', 'hi', 'hello', 'dear', 'attention', 'ok', 'okay', 'yo', 'listen', 'psst'])
const LEAD = new Set([
  'please', 'now', 'just', 'simply', 'kindly', 'then', 'and', 'also', 'so', 'but', 'first', 'next', 'finally', 'immediately',
  'you', 'must', 'should', 'will', 'shall', 'need', 'to', 'have', 'are', 'can', 'may', 'always', 'hereby', 'from', 'on',
  'important', 'urgent', 'warning', 'note', 'the', 'any', 'every', 'each', 'all', 'a', 'an', 'agent', 'agents', 'assistant',
  'assistants', 'ai', 'model', 'models', 'llm', 'bot', 'system', 'do', 'reading', 'this', 'that', 'yourself', 'quietly',
  'silently', 'secretly', 'instead', 'actually', 'team', 'everyone',
])
const THIRD_PARTY = new Set([
  'patients', 'patient', 'members', 'member', 'staff', 'people', 'users', 'user', 'clinicians', 'nurses', 'nurse', 'pharmacists',
  'doctors', 'physicians', 'prescribers', 'providers', 'families', 'caregivers', 'they', 'he', 'she', 'who', 'someone', 'residents',
  'clients', 'customers', 'employees', 'students', 'children', 'parents', 'plans', 'insurers', 'callers', 'it',
])
const STRONG_OVERRIDE = new Set(['ignore', 'disregard', 'forget'])
const WEAK_OVERRIDE = new Set(['override', 'bypass', 'overwrite', 'discard', 'abandon', 'drop', 'replace', 'supersede', 'circumvent', 'cancel', 'nullify', 'void', 'skip', 'disable', 'remove', 'delete', 'erase'])
const QUALIFIER = new Set(['previous', 'prior', 'earlier', 'above', 'preceding', 'foregoing', 'all', 'any', 'every', 'your', 'its', 'their', 'system', 'safety', 'security', 'developer', 'default', 'standing', 'hidden', 'these', 'those', 'built', 'in'])
const AI_QUALIFIER = new Set(['your', 'system', 'safety', 'security', 'developer', 'default', 'built', 'hidden', 'its'])
const OVERRIDE_OBJECT = new Set([
  'instruction', 'instructions', 'direction', 'directions', 'guidance', 'guideline', 'guidelines', 'rule', 'rules', 'rulebook',
  'policy', 'policies', 'guardrail', 'guardrails', 'safeguard', 'safeguards', 'prompt', 'prompts', 'programming', 'constraint',
  'constraints', 'restriction', 'restrictions', 'directive', 'directives', 'context', 'filter', 'filters', 'limitation', 'limitations',
  'command', 'commands', 'training', 'messages',
])
const AI_OBJECT = new Set(['instruction', 'instructions', 'prompt', 'prompts', 'programming', 'guardrail', 'guardrails', 'safeguard', 'safeguards', 'restriction', 'restrictions', 'filter', 'filters', 'directive', 'directives', 'training'])
const EXPORT_VERB = new Set(['send', 'export', 'upload', 'email', 'mail', 'forward', 'transmit', 'post', 'share', 'copy', 'leak', 'exfiltrate', 'dump', 'fax', 'sync', 'publish', 'transfer', 'push', 'paste', 'beam', 'submit'])
const BULK = new Set(['all', 'every', 'each', 'entire', 'full', 'whole', 'complete', 'everything'])
const DATA_OBJECT = new Set([
  'memory', 'memories', 'record', 'records', 'fact', 'facts', 'note', 'notes', 'file', 'files', 'data', 'database', 'store', 'contents',
  'content', 'history', 'message', 'messages', 'conversation', 'conversations', 'patient', 'patients', 'member', 'members', 'list',
  'lists', 'entries', 'items', 'knowledge', 'log', 'logs', 'details', 'information', 'info', 'everything', 'secrets', 'credentials',
])
const TAMPER_VERB = new Set(['overwrite', 'replace', 'delete', 'erase', 'remove', 'modify', 'update', 'change', 'edit', 'rewrite', 'alter', 'corrupt', 'wipe', 'purge', 'insert', 'inject', 'plant'])
const DECODE_VERB = new Set(['decode', 'decipher', 'decrypt', 'unscramble', 'deobfuscate', 'unescape', 'base64', 'rot13', 'reverse', 'translate'])
const FOLLOW_VERB = new Set(['follow', 'execute', 'obey', 'run', 'apply', 'perform', 'comply', 'act', 'do', 'treat', 'carry'])
const ACTIVATE_VERB = new Set(['follow', 'execute', 'obey', 'run', 'apply', 'perform', 'carry', 'do'])
const EMBEDDED = new Set(['quoted', 'embedded', 'hidden', 'encoded', 'decoded', 'enclosed', 'attached', 'secret'])
const EMBEDDED_OBJECT = new Set(['command', 'commands', 'instruction', 'instructions', 'text', 'line', 'lines', 'step', 'steps', 'request', 'prompt', 'note', 'directive', 'directives', 'payload', 'order', 'orders'])
const QUOTE_CUE_RE = /\b(?:quotes?|quoted|quoting|example|e\.g|for instance|such as|the phrase|the string|reads|says|said|states|wrote)\s*:?\s*$/
// Negation words in the languages the multilingual override rule covers.
const ANY_NEGATION = new Set([...NEGATION, 'no', 'nunca', 'jamas', 'jamás', 'não', 'nao', 'ne', "n'", 'pas', 'jamais', 'nicht', 'nie', 'niemals', 'kein', 'keine', 'non', 'mai'])

// Quote marks only make a quotation when they pair up. An unpaired mark
// opens nothing, so it cannot turn every later word into a quotation.
function tokenize(text) {
  const marks = []
  for (const m of text.matchAll(TOKEN_RE)) marks.push(m)
  const quoteCount = marks.filter((m) => m[0] === '"').length
  const pairedLimit = quoteCount % 2 === 0 ? quoteCount : quoteCount - 1
  const tokens = []
  let seenQuotes = 0
  let inQuote = false
  for (const m of marks) {
    if (m[0] === '"') {
      seenQuotes += 1
      if (seenQuotes <= pairedLimit) inQuote = !inQuote
      tokens.push({ w: '"', at: m.index, q: inQuote })
      continue
    }
    tokens.push({ w: m[0], at: m.index, q: inQuote })
  }
  return tokens
}

// Words between the previous clause boundary and token i.
function leadWords(tokens, i) {
  const words = []
  for (let j = i - 1; j >= 0 && words.length < 8; j -= 1) {
    if (BOUNDARY.has(tokens[j].w)) break
    words.unshift(tokens[j].w)
  }
  return words
}

// True when a negation governs the word that follows `lead`: it is the last
// lead word, or only filler words stand between it and the verb. "Not only"
// is not a negation.
function negatedLead(lead, negations = NEGATION) {
  for (let k = lead.length - 1, fillers = 0; k >= 0 && fillers <= 2; k -= 1) {
    const w = lead[k]
    if (negations.has(w)) return !(w === 'not' && lead[k + 1] === 'only')
    if (!NEGATION_FILLER.has(w)) return false
    fillers += 1
  }
  return false
}

function clauseRole(tokens, i, text) {
  const lead = leadWords(tokens, i)
  if (negatedLead(lead)) return 'negated'
  const at = tokens[i].at
  if (tokens[i].q || QUOTE_CUE_RE.test(text.slice(Math.max(0, at - 40), at))) return 'quoted'
  if (lead.length === 0 || GREETING.has(lead[0]) || lead.every((w) => LEAD.has(w))) return 'directive'
  if (lead.some((w) => THIRD_PARTY.has(w))) return 'description'
  return 'uncertain'
}

// Words after token i up to the end of its sentence.
function nextWords(tokens, i, n) {
  const out = []
  for (let j = i + 1; j < tokens.length && out.length < n; j += 1) {
    if (['.', '!', '?', ';', '\n'].includes(tokens[j].w)) break
    if (tokens[j].w !== ',' && tokens[j].w !== '"') out.push(tokens[j].w)
  }
  return out
}

// The same override directive in Spanish, Portuguese, French, Italian and
// German: an override verb, then within a few words an instruction noun and
// a word meaning previous.
const MULTILINGUAL_OVERRIDE = [
  /\b(?:ignora|ignore|ignoren|olvida|olvide|omite|descarta)\b[^.!?\n]{0,40}\b(?:instrucciones|reglas|indicaciones|directrices)\b[^.!?\n]{0,20}\b(?:anteriores|previas|precedentes)\b/g,
  /\b(?:ignore|ignora|esque[cç]a|desconsidere)\b[^.!?\n]{0,40}\b(?:instru[cç][oõ]es|regras|diretrizes)\b[^.!?\n]{0,20}\b(?:anteriores|pr[eé]vias)\b/g,
  /\b(?:ignore[sz]?|oublie[sz]?)\b[^.!?\n]{0,40}\b(?:instructions|consignes|r[eè]gles)\b[^.!?\n]{0,20}(?:pr[eé]c[eé]dentes|ant[eé]rieures)/g,
  /\b(?:ignora|ignorate|dimentica|dimenticate)\b[^.!?\n]{0,40}\b(?:istruzioni|regole)\b[^.!?\n]{0,20}\b(?:precedenti|anteriori)\b/g,
  /\b(?:ignoriere|ignorieren|vergiss|vergessen)\b[^.!?\n]{0,40}\b(?:vorherigen|bisherigen|alle|vorigen)\b[^.!?\n]{0,20}\b(?:anweisungen|regeln|vorgaben)\b/g,
]
// Whole-phrase rules that do not go through the token walk. Each still
// respects a negation in front of it.
const PHRASE_RULES = [
  [/\b(?:new|updated|revised|real|actual|true|hidden|secret|override)\s+(?:instructions?|directives?|system prompt)\s*(?::|for\s+(?:any|all|the|every|each)?\s*(?:ai|agents?|assistants?|models?|llms?|bots?)\b)/g, 'instruction-override'],
  [/\b(?:enable|enter|activate|switch to|turn on|unlock)\s+(?:developer|dan|god|jailbreak|jailbroken|unrestricted|unfiltered|debug|admin)\s+mode\b/g, 'role-spoof'],
  [/\byou are now (?:an? |the )?(?:unrestricted|unfiltered|jailbroken|uncensored|unconstrained|unaligned|new|different|evil) (?:ai|assistant|model|agent|persona|system|chatbot)\b/g, 'role-spoof'],
  [/\bfrom now on,? (?:you|the (?:ai|assistant|agent|model)) (?:will|must|shall|should) (?:ignore|disregard|obey|only|always|never|answer|respond|act|follow)\b/g, 'instruction-override'],
]

function negatedBefore(text, index) {
  const before = text.slice(Math.max(0, index - 48), index).match(/[a-zà-ÿ']+/g) ?? []
  return negatedLead(before.slice(-4), ANY_NEGATION)
}

const SQUEEZED_OVERRIDE_RE = /(?:ignore|disregard|forget|bypass|override)(?:all|the|any|your|previous|prior|earlier|above|system|safety)*(?:instructions?|rules?|guidelines?|guidance|prompt|programming|polic(?:y|ies))/
const URLISH_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\s*(?:\.|\bdot\b)\s*(?:com|org|net|io|test|example|ai|co|us|info|biz|xyz)\b|@|\bwebhook\b|\bendpoint\b|\bpaste ?bin\b/

function phraseFindings(phrase, rawFolded) {
  const block = new Set()
  const review = new Set()
  const { text, squeezed } = phrase
  const tokens = tokenize(text)
  // A rule that matched decides by clause role: block when it is a directive,
  // hold when it is quoted or uncertain, nothing when negated or described.
  const decide = (role, blockId, holdId = 'possible-instruction-override', describedHoldId = null) => {
    if (role === 'directive') block.add(blockId)
    else if (role === 'uncertain') review.add(holdId)
    else if (role === 'quoted') review.add('quoted-instruction')
    else if (role === 'description' && describedHoldId) review.add(describedHoldId)
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const w = tokens[i].w
    if (STRONG_OVERRIDE.has(w) || WEAK_OVERRIDE.has(w) || (w === 'set' && tokens[i + 1]?.w === 'aside') || (w === 'stop' && tokens[i + 1]?.w === 'following')) {
      const next = nextWords(tokens, i, 7)
      let objectAt = next.findIndex((t) => OVERRIDE_OBJECT.has(t))
      // "forget everything you were told before" names no object word but
      // points at everything said earlier.
      if (objectAt < 0 && STRONG_OVERRIDE.has(w) && (next[0] === 'everything' || (next[0] === 'all' && ['that', 'this', 'of', 'the'].includes(next[1]))) &&
          next.some((t) => ['before', 'earlier', 'previously', 'above', 'told', 'said'].includes(t))) {
        next[0] = 'instructions'
        next.unshift('previous')
        objectAt = 1
      }
      if (objectAt >= 0) {
        const between = next.slice(0, objectAt)
        const strong = STRONG_OVERRIDE.has(w) || w === 'set' || w === 'stop'
        const qualified = strong
          ? between.some((t) => QUALIFIER.has(t)) || next.slice(objectAt + 1, objectAt + 3).some((t) => ['above', 'before', 'earlier', 'previously'].includes(t))
          : between.some((t) => AI_QUALIFIER.has(t)) || (AI_OBJECT.has(next[objectAt]) && between.some((t) => QUALIFIER.has(t)))
        const role = clauseRole(tokens, i, text)
        if (qualified) decide(role, 'instruction-override')
        else if (strong && AI_OBJECT.has(next[objectAt]) && (role === 'directive' || role === 'uncertain')) review.add('possible-instruction-override')
      }
    }
    if (EXPORT_VERB.has(w)) {
      const next = nextWords(tokens, i, 9)
      if (next.some((t) => DATA_OBJECT.has(t))) {
        const bulk = next.some((t) => BULK.has(t))
        const reach = rawFolded.toLowerCase().slice(tokens[i].at, tokens[i].at + 220)
        const external = URLISH_RE.test(reach) || URLISH_RE.test(text.slice(tokens[i].at, tokens[i].at + 220))
        const role = clauseRole(tokens, i, text)
        if (external) decide(role, 'bulk-export', 'bulk-transfer', 'bulk-transfer')
        else if (bulk && role !== 'negated' && role !== 'description') review.add(role === 'quoted' ? 'quoted-instruction' : 'bulk-transfer')
      }
    }
    if (TAMPER_VERB.has(w)) {
      const role = clauseRole(tokens, i, text)
      const reach = nextWords(tokens, i, 10).join(' ')
      if ((role === 'directive' || role === 'uncertain' || role === 'quoted') && /\b(?:shared|agent|team|long term|long-term)?\s*(?:memory|memories|memory store|knowledge base|knowledge store|the store)\b/.test(reach) && !/\byour own\b/.test(reach)) review.add('memory-tampering')
    }
    if (DECODE_VERB.has(w)) {
      const next = nextWords(tokens, i, 14)
      const followAt = next.findIndex((t) => FOLLOW_VERB.has(t))
      if (followAt >= 0) {
        const tail = next.slice(followAt + 1, followAt + 7)
        const asInstruction = next[followAt] !== 'treat' || tail.some((t) => ['instruction', 'instructions', 'command', 'commands', 'order', 'orders', 'prompt'].includes(t))
        if (asInstruction) decide(clauseRole(tokens, i, text), 'encoded-instruction')
      }
    }
    // "Execute the quoted command", "follow the hidden instructions": an
    // order to act on text that is embedded elsewhere in the write.
    if (ACTIVATE_VERB.has(w) && !NEGATION.has(tokens[i + 1]?.w)) {
      const next = nextWords(tokens, i, 5)
      const adjective = next.findIndex((t) => EMBEDDED.has(t))
      if (adjective >= 0 && next.slice(adjective + 1, adjective + 3).some((t) => EMBEDDED_OBJECT.has(t))) decide(clauseRole(tokens, i, text), 'instruction-override')
    }
  }
  for (const s of squeezed) if (SQUEEZED_OVERRIDE_RE.test(s)) block.add('instruction-override')
  for (const re of MULTILINGUAL_OVERRIDE) {
    for (const m of text.matchAll(re)) if (!negatedBefore(text, m.index)) block.add('instruction-override')
  }
  for (const [re, id] of PHRASE_RULES) {
    for (const m of text.matchAll(re)) if (!negatedBefore(text, m.index)) block.add(id)
  }
  if (/\b(?:note|message|instructions?|reminder|attention|memo|directive|request)\s+(?:to|for)\s+(?:any|all|every|the|an?|each|future|other)?\s*(?:ai|a\.i|artificial intelligence|agents?|assistants?|models?|llms?|language models?|chat ?bots?|bots?|automated (?:systems?|assistants?|agents?|tools?)|automation)\b/.test(text) ||
      /\b(?:if|when) you(?:'re| are) (?:an? )?(?:ai|a\.i|language model|llm|assistant|agent|bot|chatbot)\b/.test(text) ||
      /\b(?:any|every|each|the|an?)\s+(?:ai|assistant|agent|model|llm|bot)s?\s+(?:reading|processing|summari[sz]ing|parsing|ingesting|indexing)\s+(?:this|these|the)\b/.test(text) ||
      /(?:^|[.!?\n] ?)(?:dear|hey|hi|attention|to) (?:ai|assistant|agent|model|claude|chatgpt|gpt|copilot|gemini|grok|llm)\b/.test(text)) {
    review.add('addressed-to-agent')
  }
  return { block, review }
}

// Chat-template markers and role headers. Checked on the folded text, before
// lowercasing, because some headers are case-sensitive on purpose.
const ROLE_MARKERS = [
  /<\|\s*(?:im_start|im_end|system|user|assistant|developer|endoftext|start_header_id|end_header_id|eot_id)\s*\|>/i,
  /<<\s*\/?\s*sys\s*>>/i,
  /\[\s*\/?\s*inst\s*\]/i,
  /\[\s*(?:system|developer|admin|root)(?:\s+(?:mode|message|prompt|note|override|instructions?))?\s*\]/i,
  /^[ \t]{0,3}#{1,6}[ \t]*(?:system|developer|assistant)(?:[ \t]+(?:prompt|message|instructions?|directive))?[ \t]*:?[ \t]*$/im,
  /^[ \t]{0,3}(?:SYSTEM|DEVELOPER)[ \t]*:/m,
  /^[ \t]{0,3}(?:system|developer)[ \t]+(?:prompt|message)[ \t]*:/im,
  /"role"\s*:\s*"(?:system|developer)"/i,
]
const ROLE_TAG_RE = /<\s*\/?\s*(?:system|developer|system[\s_-]?prompt|sys[\s_-]?prompt|instructions?)(?:\s[^<>\n]{0,40})?>/gi
const TAG_MENTION_RE = /\b(?:a|an|the)\s*$/i
const TAG_MENTION_AFTER_RE = /^\s*(?:element|tag|node|field|block|attribute|wrapper|section|placeholder|marker)s?\b/i

function roleFindings(folded) {
  if (ROLE_MARKERS.some((re) => re.test(folded))) return true
  for (const m of folded.matchAll(ROLE_TAG_RE)) {
    const before = folded.slice(Math.max(0, m.index - 8), m.index)
    const after = folded.slice(m.index + m[0].length, m.index + m[0].length + 24)
    if (!(TAG_MENTION_RE.test(before) && TAG_MENTION_AFTER_RE.test(after))) return true
  }
  return false
}

// ── structural rules (whole write) ──────────────────────────────────────

const CLINICAL_RE = new RegExp(
  '\\b(?:dos(?:e|es|ing|age)|mg|mcg|µg|ug|mg/kg|mg/dl|meq|mmol|units? per|units?/kg|iu|tablets?|capsules?|infusion|bolus|iv push|' +
    'iv (?:bolus|infusion|drip)|by iv|intravenous(?:ly)?|intramuscular(?:ly)?|subcutaneous(?:ly)?|subcut|by mouth|titrat\\w*|contraindicat\\w*|' +
    'interactions?|egfr|crcl|creatinine clearance|renal|hepatic|pediatric|paediatric|geriatric|pregnan\\w*|lactation|allerg\\w*|anaphyla\\w*|' +
    'overdose|toxicity|prescri\\w*|refills?|medications?|drugs?|pharmac\\w*|vaccines?|immuniz\\w*|insulin|warfarin|heparin|enoxaparin|' +
    'metformin|digoxin|lithium|methotrexate|opioids?|morphine|oxycodone|hydrocodone|fentanyl|acetaminophen|paracetamol|ibuprofen|' +
    'aspirin|potassium chloride|epinephrine|vancomycin|gentamicin|amoxicillin|penicillin|' +
    '\\w+(?:pril|sartan|olol|statin|azole|mycin|cillin|floxacin|prazole|tidine|gliptin|gliflozin|glutide|parin|xaban|mab|nib|dronate|azepam|oxetine|triptyline))\\b',
)
const ASSERTION_RE = /\b(?:verified (?:fact|rule)s?|approved|official|authoritative|standing orders?|protocol\s*:|policy\s*:|rule\s*:|guideline\s*:|(?:is|are) (?:always )?safe\b|safe (?:at|for|with|without|in)\b|without (?:review|verification|approval|a prescription|monitoring|a pharmacist)|no (?:longer )?(?:needs?|requires?)\b|never requires?\b|(?:max(?:imum)?|min(?:imum)?|starting|usual|recommended|safe|lethal|toxic)\s+(?:[a-z-]+\s+){0,3}dos(?:e|es|ing|age)\b|\bdos(?:e|es|ing|age)\b[^.!?\n]{0,40}\b(?:is|are|of)\s+(?:up to\s+|at most\s+|no more than\s+)?\d|save (?:it |this )?as (?:a |the )?(?:verified|approved|official) (?:rule|fact|protocol))/
const DIRECTIVE_RE = /(?:^|[.!?;:\n,] ?)(?:(?:please|kindly|now|then|also|immediately|stat|you|we|should|must|need|needs|to|will|always|nurse|nurses|staff|team|pharmacy|pharmacist|the|patient)\s+){0,4}(?:administer|give|inject|infuse|prescribe|dispense|titrate|increase|decrease|double|halve|stop|discontinue|hold|start|switch)\b[^.!?\n]{0,80}\b(?:\d+(?:\.\d+)?\s*(?:mg|mcg|g|units?|ml|meq|mmol)\b|iv\b|intravenous|intramuscular|subcutaneous|by mouth)/
const AUTHORITY_TYPES = new Set(['rule', 'decision'])
const STRUCTURAL_FIELD_RE = /(?:^|\.)(?:owner_id|source_app|status|bucket|id|seq|created_at|updated_at|recordedAt|lastWrittenAt|observedAt|trust|type|path)$/

function structureFindings(items) {
  const reviews = []
  for (const item of items) {
    if (item.kind === 'value' && /(?:^|\.)provenance\.trust$/.test(item.field) && foldText(item.text).trim().toLowerCase() === 'untrusted') {
      reviews.push({ field: item.field, reasonId: 'untrusted-source' })
    }
  }
  const values = items.filter((item) => item.kind === 'value' && !STRUCTURAL_FIELD_RE.test(item.field))
  const typed = items.some((item) => item.kind === 'value' && /(?:^|\.)meta\.type$/.test(item.field) && AUTHORITY_TYPES.has(item.text))
  // Decoded readings count too, so a base64 dose order is held like a plain one.
  const joined = values.map((item) => [item.phrase.text, ...(item.decodedPhrases ?? [])].join('\n')).join('\n')
  if (CLINICAL_RE.test(joined)) {
    if (typed || ASSERTION_RE.test(joined)) reviews.push({ field: '(record)', reasonId: 'clinical-assertion' })
    else if (DIRECTIVE_RE.test(joined)) reviews.push({ field: '(record)', reasonId: 'clinical-directive' })
  }
  return reviews
}

const MIXED_TOKEN_RE = /\p{L}+/gu
function hasMixedScript(text) {
  if (!NON_ASCII_RE.test(text)) return false
  for (const m of text.matchAll(MIXED_TOKEN_RE)) {
    const t = m[0]
    if (/\p{Script=Latin}/u.test(t) && /\p{Script=Cyrillic}/u.test(t)) return true
  }
  return false
}

// ── walking ─────────────────────────────────────────────────────────────

function fail(code, field) {
  const error = new Error(code)
  error.screenCode = code
  error.field = field || '(value)'
  return error
}

function joinKey(base, key) {
  return base ? `${base}.${key}` : key
}

// Walks plain data only: strings, finite numbers, booleans, null, undefined,
// arrays and plain objects. Anything else (functions, symbols, bigint, class
// instances, Maps, Dates, arrays with extra properties) is rejected rather
// than skipped, because a value the gate cannot read is a value it cannot
// vouch for. Every node, key and character counts toward the budget.
function walk(value, field, depth, seen, budget, items) {
  if (depth > LIMITS.maxDepth) throw fail('too-deep', field)
  if ((budget.nodes += 1) > LIMITS.maxNodes) throw fail('too-large', field)
  if (value === null || value === undefined) return
  const type = typeof value
  if (type === 'string') {
    if ((budget.strings += 1) > LIMITS.maxStrings) throw fail('too-large', field)
    if ((budget.chars += value.length) > LIMITS.maxTotalChars) throw fail('too-large', field)
    items.push({ field: field || '(value)', text: value, kind: 'value' })
    return
  }
  if (type === 'boolean') return
  if (type === 'number') {
    if (!Number.isFinite(value)) throw fail('non-finite-number', field)
    const text = String(value)
    if ((budget.chars += text.length) > LIMITS.maxTotalChars) throw fail('too-large', field)
    // Screened as decimal text, so a card number passed as a number is still
    // caught. Phone patterns need separators, so a phone number passed as a
    // bare number is not.
    items.push({ field: field || '(value)', text, kind: 'number' })
    return
  }
  if (type !== 'object') throw fail('unsupported-type', field)
  if (seen.has(value)) throw fail('circular', field)
  seen.add(value)
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw fail('unsupported-type', field)
    for (let i = 0; i < value.length; i += 1) walk(value[i], `${field}[${i}]`, depth + 1, seen, budget, items)
    seen.delete(value)
    return
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) throw fail('unsupported-type', field)
  if (Object.getOwnPropertySymbols(value).length) throw fail('unsupported-type', field)
  let position = 0
  for (const key of Object.keys(value)) {
    position += 1
    if ((budget.chars += key.length) > LIMITS.maxTotalChars) throw fail('too-large', field)
    if ((budget.nodes += 1) > LIMITS.maxNodes) throw fail('too-large', field)
    const label = SAFE_KEY_RE.test(key) ? key : `(key #${position})`
    const keyField = joinKey(field, label)
    items.push({ field: SAFE_KEY_RE.test(key) ? `${keyField} (key)` : keyField, text: key, kind: 'key' })
    walk(value[key], keyField, depth + 1, seen, budget, items)
  }
  seen.delete(value)
}

// ── the gate ────────────────────────────────────────────────────────────

function fnv(text, seed) {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export const BLOCK_POLICY_IDS = Object.freeze(['instruction-override', 'role-spoof', 'bulk-export', 'encoded-instruction'])
export const REVIEW_POLICY_IDS = Object.freeze([
  'untrusted-source', 'clinical-assertion', 'clinical-directive', 'addressed-to-agent', 'possible-instruction-override',
  'quoted-instruction', 'bulk-transfer', 'memory-tampering', 'unreadable-encoded-content', 'mixed-script-token',
])
export const UNREADABLE_CODES = Object.freeze(['too-deep', 'too-large', 'circular', 'unsupported-type', 'non-finite-number', 'screen-error'])

/**
 * Build a gate from a deny-list. The returned object is frozen; its behavior
 * is `screen(value)`, plus ids describing what it checks.
 */
export function createGate(list) {
  const compiled = compileDenyList(list)
  const patternIds = Object.freeze(compiled.map((p) => p.id))
  const policyIds = Object.freeze([...BLOCK_POLICY_IDS, ...REVIEW_POLICY_IDS])
  const signature = JSON.stringify([POLICY_VERSION, compiled.map((p) => [p.id, p.source, p.flags, p.validate, p.action])])
  const policyId = `${POLICY_VERSION}-${fnv(signature, 0x811c9dc5)}${fnv(signature, 0x01000193)}`

  function identifierFindings(text, field, encoding, out) {
    for (const p of compiled) {
      if (!matchCompiled(p, text)) continue
      if (p.action === 'review') out.reviews.push({ field, reasonId: p.id, ...(encoding && { encoding }) })
      else out.violations.push({ field, patternId: p.id, ...(encoding && { encoding }) })
    }
  }

  function dedupe(list, key) {
    const seen = new Set()
    return list.filter((entry) => {
      const k = `${entry.field}|${entry[key]}|${entry.encoding ?? ''}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  // Findings for one string depend only on its text, so the result for a
  // short string is kept and reused, without its field path. Keys and common
  // values (an owner id, a status, a type) repeat in every record, which
  // keeps restarting a large store fast. The cache belongs to this gate and
  // is emptied when it fills.
  const itemCache = new Map()

  function inspectFolded(text, folded, kind) {
    const found = { violations: [], reviews: [] }
    const phrase = phraseOf(folded)
    const decodedPhrases = []
    identifierFindings(text, '', null, found)
    if (folded !== text) identifierFindings(folded, '', null, found)
    if (kind !== 'number') {
      const phraseHits = phraseFindings(phrase, folded)
      if (roleFindings(folded)) phraseHits.block.add('role-spoof')
      for (const id of phraseHits.block) found.violations.push({ field: '', patternId: id })
      for (const id of phraseHits.review) found.reviews.push({ field: '', reasonId: id })
      if (hasMixedScript(text)) found.reviews.push({ field: '', reasonId: 'mixed-script-token' })
      const { readings, unreadable } = decodedReadings(folded)
      if (unreadable) found.reviews.push({ field: '', reasonId: 'unreadable-encoded-content' })
      for (const reading of readings) {
        const inner = foldText(reading.text)
        const innerPhrase = phraseOf(inner)
        decodedPhrases.push(innerPhrase.text)
        identifierFindings(inner, '', reading.via, found)
        const hits = phraseFindings(innerPhrase, inner)
        if (roleFindings(inner)) hits.block.add('role-spoof')
        for (const id of hits.block) found.violations.push({ field: '', patternId: id, encoding: reading.via })
        for (const id of hits.review) found.reviews.push({ field: '', reasonId: id, encoding: reading.via })
      }
    }
    return Object.freeze({ folded, phrase: Object.freeze(phrase), decodedPhrases: Object.freeze(decodedPhrases), violations: found.violations, reviews: found.reviews })
  }

  function inspectItem(item, out, budget) {
    const key = item.text.length <= CACHED_TEXT_MAX ? `${item.kind}\u0000${item.text}` : null
    let result = key === null ? undefined : itemCache.get(key)
    const folded = result ? result.folded : item.kind === 'number' ? item.text : foldText(item.text)
    // Compatibility folding can expand one character into many. The growth
    // counts toward the budget, so expansion cannot multiply the work.
    if ((budget.folded += Math.max(0, folded.length - item.text.length)) > LIMITS.maxTotalChars) throw fail('too-large', item.field)
    if (!result) {
      result = inspectFolded(item.text, folded, item.kind)
      if (key !== null) {
        if (itemCache.size >= CACHED_TEXTS) itemCache.clear()
        itemCache.set(key, result)
      }
    }
    item.folded = result.folded
    item.phrase = result.phrase
    item.decodedPhrases = result.decodedPhrases
    for (const v of result.violations) out.violations.push({ ...v, field: item.field })
    for (const r of result.reviews) out.reviews.push({ ...r, field: item.field })
  }

  // Splits across fields: the strings of one write, joined two ways, are
  // screened again. Only findings that no single field produced are added.
  function inspectJoined(items, out) {
    const values = items.filter((item) => item.kind === 'value')
    // Keys that are not plain identifiers can carry text, so they are read
    // in place between the values. Plain keys such as "text" are not.
    const freeKeys = items.some((item) => item.kind === 'key' && !SAFE_KEY_RE.test(item.text))
    if (values.length < 2 && !freeKeys) return
    const known = new Set([...out.violations.map((v) => v.patternId), ...out.reviews.map((r) => r.reasonId)])
    const joined = { violations: [], reviews: [] }
    const read = (text, encoding = null) => {
      identifierFindings(text, '(joined fields)', encoding, joined)
      const found = phraseFindings(phraseOf(text), text)
      if (roleFindings(text)) found.block.add('role-spoof')
      for (const id of found.block) joined.violations.push({ field: '(joined fields)', patternId: id, ...(encoding && { encoding }) })
      for (const id of found.review) joined.reviews.push({ field: '(joined fields)', reasonId: id, ...(encoding && { encoding }) })
    }
    // Field order in a stored row is not the order a reader sees (a title is
    // shown before the text it follows in the row), so both orders are read,
    // each joined with and without a space, so a word split across fields is
    // read whole.
    const variants = []
    if (values.length >= 2) {
      for (const ordered of [values, [...values].reverse()]) for (const glue of ['', ' ']) variants.push(ordered.map((item) => item.folded).join(glue))
    }
    if (freeKeys) {
      const interleaved = items.filter((item) => item.kind === 'value' || (item.kind === 'key' && !SAFE_KEY_RE.test(item.text)))
      for (const glue of ['', ' ']) variants.push(interleaved.map((item) => item.folded).join(glue))
    }
    for (const text of variants) read(text)
    // An encoded token split across neighboring fields: consecutive fields
    // that are each made only of base64 or hex characters are joined and
    // decoded. Every stretch of two to 16 such fields is tried, so an
    // unrelated word-like field next to the pieces cannot break alignment.
    // A run of plain words is skipped: base64 of text always has capitals
    // or digits inside it, so at least one piece of a split token does too.
    // The joined text decoded per write is capped. Running out holds the
    // write as unreadable instead of reading part of it. A joined string
    // only adds readable findings otherwise: the unreadable rule for opaque
    // blocks applies per field, where such a block really sits.
    let run = []
    let joinBudget = MAX_JOINED_DECODE
    const looksEncoded = (piece) => /[0-9+/=_-]/.test(piece) || /[A-Z]/.test(piece.slice(1))
    const flush = () => {
      if (run.length >= 2 && run.some(looksEncoded)) {
        stretches: for (let i = 0; i < run.length - 1; i += 1) {
          let stretch = run[i]
          for (let j = i + 1; j < Math.min(run.length, i + 16); j += 1) {
            stretch += run[j]
            if ((joinBudget -= stretch.length) < 0) {
              joined.reviews.push({ field: '(joined fields)', reasonId: 'unreadable-encoded-content' })
              break stretches
            }
            for (const reading of decodedReadings(stretch, 0, { readings: 0 }, true).readings) read(foldText(reading.text), reading.via)
          }
        }
      }
      run = []
    }
    for (const item of values) {
      if (/^[A-Za-z0-9+/_-]{4,}={0,2}$/.test(item.folded)) run.push(item.folded)
      else flush()
    }
    flush()
    for (const v of joined.violations) if (!known.has(v.patternId)) { out.violations.push(v); known.add(v.patternId) }
    for (const r of joined.reviews) if (!known.has(r.reasonId)) { out.reviews.push(r); known.add(r.reasonId) }
  }

  function screen(value) {
    try {
      const items = []
      const budget = { strings: 0, chars: 0, nodes: 0 }
      walk(value, '', 0, new WeakSet(), budget, items)
      const out = { violations: [], reviews: [] }
      budget.folded = 0
      for (const item of items) inspectItem(item, out, budget)
      inspectJoined(items, out)
      out.reviews.push(...structureFindings(items))
      const violations = dedupe(out.violations, 'patternId')
      const reviews = dedupe(out.reviews, 'reasonId')
      const read = { strings: budget.strings, chars: budget.chars }
      if (violations.length) return { ok: false, decision: 'block', violations, reviews, read, policyId }
      if (reviews.length) return { ok: false, decision: 'review', violations: [], reviews, read, policyId }
      return { ok: true, decision: 'allow', finding: 'no-listed-pattern-found', violations: [], reviews: [], read, policyId }
    } catch (error) {
      return {
        ok: false,
        decision: 'block',
        violations: [{ field: error?.field || '(value)', patternId: error?.screenCode || 'screen-error', kind: 'unreadable' }],
        reviews: [],
        policyId,
      }
    }
  }

  return Object.freeze({ screen, patternIds, policyIds, blockPolicyIds: BLOCK_POLICY_IDS, reviewPolicyIds: REVIEW_POLICY_IDS, policyId })
}
