// audit-format.js: what an audit entry may contain. Shared by the store
// loader (src/server.js) and the operator scan and purge (maintenance.js), so
// whatever stops a store from loading is also what the scan lists and the
// purge clears.
//
// System-generated fields are checked by format, not by content rules: a
// payload hash is 64 hex characters and can contain a digit run that looks
// like a card number. Free text (a reviewer label, and the path and details
// of entries written before 2026-11-03) is screened by the gate. Any other
// field is unexpected.

const FORMATS = Object.freeze({
  op: /^[a-z_]{2,32}$/,
  target: /^[A-Za-z][A-Za-z0-9]{0,40}$/,
  decision: /^(?:allow|review|block)$/,
  payload_sha256: /^[0-9a-f]{64}$/,
  result_ref: /^[a-z]{2,8}_\d{1,9}$/,
  hold_id: /^[a-z]{2,8}_\d{1,9}$/,
  policy: /^[0-9A-Za-z.-]{1,64}$/,
  at: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/,
})
const FREE_TEXT = new Set(['reviewer', 'path', 'details'])
const NUMBERS = new Set(['violation_count', 'count'])
const IDS = new Set(['pattern_ids', 'review_ids'])

function wellFormed(key, value) {
  if (FORMATS[key]) return typeof value === 'string' && FORMATS[key].test(value)
  if (NUMBERS.has(key)) return Number.isFinite(value)
  if (IDS.has(key)) return Array.isArray(value) && value.every((id) => typeof id === 'string' && /^[a-z0-9-]{1,64}$/.test(id))
  if (key === 'counts') return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(Number.isInteger)
  return false
}

/**
 * Split an audit entry into the fields that do not fit the schema and the
 * free text the gate must screen.
 * @returns {{ unexpected: string[], freeText: object }}
 */
export function auditFields(entry) {
  const unexpected = []
  const freeText = {}
  for (const [key, value] of Object.entries(entry)) {
    if (FREE_TEXT.has(key)) freeText[key] = value
    else if (!wellFormed(key, value)) unexpected.push(key)
  }
  return { unexpected, freeText }
}
