// guarded-store.js: the only store object tools and seeding ever see.
//
// Built mechanically from the raw store's method classification:
//   - read methods pass through unchanged
//   - write methods take a structured-clone snapshot of their arguments,
//     screen the snapshot with the gate and hand only that snapshot to the
//     raw method, so a getter or proxy cannot show the gate one value and
//     the store another
//   - internal methods are never exposed; only this module calls them
//   - any raw method that is not classified makes the guard throw, so the
//     server cannot start with it
//
// Outcomes of a write:
//   block   value-free `screen_blocked` audit entry, ScreeningError, nothing written
//   review  the snapshot is kept in the hold queue (not readable by tools),
//           `write_held` audit entry, ReviewRequiredError, nothing written
//   allow   the raw write and its audit entry commit in one transaction
//   dry-run every write that is not blocked is deferred: `write_deferred`
//
// Audit entries have a fixed schema built here. They are never screened
// against the deny-list (a pattern that matches a rule id must not erase the
// receipt) and never contain submitted values. Allowed and held writes carry
// a SHA-256 of the screened payload, so an approval can be tied to the exact
// payload that was reviewed. Deletions carry only a count.

import { createHash } from 'node:crypto'

import { DeferredWriteError, ReviewRequiredError, ScreeningError } from '../screening/screen.js'

export const AUDIT_OPS = Object.freeze([
  'screen_blocked',
  'write_allowed',
  'write_noop',
  'write_held',
  'write_deferred',
  'review_approved',
  'review_rejected',
  'record_retracted',
  'store_purged',
  'audit_redacted',
])

const AUDIT_KEYS = Object.freeze({
  op: 'string',
  target: 'string',
  pattern_ids: 'ids',
  review_ids: 'ids',
  violation_count: 'number',
  decision: 'string',
  payload_sha256: 'string',
  result_ref: 'string',
  count: 'number',
  hold_id: 'string',
  reviewer: 'string',
  policy: 'string',
  counts: 'counts',
})

const REF_RE = /^[a-z]{2,8}_\d{1,9}$/

function ownMethodNames(obj) {
  const names = new Set()
  for (let proto = Object.getPrototypeOf(obj); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name !== 'constructor' && typeof proto[name] === 'function') names.add(name)
    }
  }
  for (const name of Object.keys(obj)) {
    if (typeof obj[name] === 'function') names.add(name)
  }
  return [...names]
}

/** Stable JSON: object keys sorted, so equal payloads hash equally. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function payloadHash(args) {
  return createHash('sha256').update(canonicalJson(args)).digest('hex')
}

/**
 * A reviewer label is 1 to 100 characters that the gate would store as it is.
 * It goes into the audit log, so a label the gate would block or hold is
 * refused: a blocked one would stop the next load, and a held one would
 * reach the log without review.
 */
export function checkReviewerLabel(gate, reviewer) {
  if (typeof reviewer !== 'string' || !reviewer.trim() || reviewer.length > 100) {
    throw new Error('a reviewer label of 1 to 100 characters is required')
  }
  const verdict = gate.screen(reviewer)
  if (verdict.decision === 'block') throw new Error('the reviewer label must not contain a listed pattern')
  if (verdict.decision !== 'allow') throw new Error('the reviewer label would be held for review; use a plain label such as a name or role')
  return reviewer.trim()
}

/**
 * @param {object} rawStore  store instance
 * @param {{screen: Function, patternIds: string[], policyIds: string[], policyId: string}} gate  from createGate()
 * @param {{reads: string[], writes: string[], internal?: string[], screenedArgs?: object, writeMode?: string}} options
 * @returns {{store: object, review: object}} the guarded store and the reviewer desk
 */
export function createWriteGuard(rawStore, gate, { reads, writes, internal = [], screenedArgs = {}, writeMode = 'commit' } = {}) {
  if (!gate || typeof gate.screen !== 'function') {
    throw new Error('guarded store needs a screening gate')
  }
  if (!['commit', 'dry-run'].includes(writeMode)) throw new Error('write mode must be commit or dry-run')
  const readSet = new Set(reads)
  const writeSet = new Set(writes)
  const internalSet = new Set(internal)
  for (const name of readSet) {
    if (writeSet.has(name)) throw new Error(`store method "${name}" is classified as both read and write`)
    if (internalSet.has(name)) throw new Error(`store method "${name}" is classified as both read and internal`)
  }
  for (const name of writeSet) {
    if (internalSet.has(name)) throw new Error(`store method "${name}" is classified as both write and internal`)
  }
  const methods = ownMethodNames(rawStore)
  const unclassified = methods.filter((name) => !readSet.has(name) && !writeSet.has(name) && !internalSet.has(name))
  if (unclassified.length) {
    throw new Error(`store methods not classified as read or write: ${unclassified.join(', ')}`)
  }
  for (const name of [...readSet, ...writeSet, ...internalSet]) {
    if (typeof rawStore[name] !== 'function') throw new Error(`store has no method "${name}"`)
  }
  for (const name of ['transaction', 'appendAudit', 'addPending', 'getPending', 'listPending', 'removePending']) {
    if (!internalSet.has(name)) throw new Error(`store must provide the internal method "${name}"`)
  }

  const knownIds = new Set([...(gate.patternIds ?? []), ...(gate.policyIds ?? []), 'too-deep', 'too-large', 'circular', 'unsupported-type', 'non-finite-number', 'screen-error'])
  const policy = typeof gate.policyId === 'string' ? gate.policyId : 'unversioned'

  // Every audit entry passes through here: fixed keys and types, rule ids
  // from the gate only, references in a fixed shape. Anything else is dropped.
  function audit(entry) {
    const clean = {}
    for (const [key, kind] of Object.entries(AUDIT_KEYS)) {
      const value = entry[key]
      if (value === undefined || value === null) continue
      if (kind === 'string' && typeof value === 'string') clean[key] = value.slice(0, 200)
      if (kind === 'number' && Number.isFinite(value)) clean[key] = value
      if (kind === 'ids' && Array.isArray(value)) clean[key] = [...new Set(value.filter((id) => knownIds.has(id)))]
      if (kind === 'counts' && value && typeof value === 'object') {
        clean[key] = Object.fromEntries(Object.entries(value).filter(([k, v]) => /^[a-z_]{1,32}$/.test(k) && Number.isInteger(v)))
      }
    }
    if (!AUDIT_OPS.includes(clean.op)) throw new Error('audit entry has an unknown op')
    if (clean.result_ref && !REF_RE.test(clean.result_ref)) delete clean.result_ref
    if (clean.hold_id && !REF_RE.test(clean.hold_id)) delete clean.hold_id
    if (clean.payload_sha256 && !/^[0-9a-f]{64}$/.test(clean.payload_sha256)) delete clean.payload_sha256
    rawStore.appendAudit(clean)
  }

  function screenedView(name, snapshot) {
    const view = screenedArgs[name]
    return view ? view(snapshot) : snapshot
  }

  function snapshotOf(args) {
    try {
      return { ok: true, value: structuredClone(args) }
    } catch {
      return { ok: false }
    }
  }

  // Args are screened as one array, so field paths start with "[n]". Turn
  // "[0].text" into "text" and "[1]" into "argument 2" for readable errors.
  const readableField = (field) => {
    const m = /^\[(\d+)\]\.?(.*)$/.exec(field)
    if (!m) return field
    const arg = `argument ${Number(m[1]) + 1}`
    return !m[2] ? arg : m[2].startsWith('[') ? `${arg}${m[2]}` : m[2]
  }
  const readable = (verdict) => ({
    ...verdict,
    violations: verdict.violations.map((v) => ({ ...v, field: readableField(v.field) })),
    reviews: (verdict.reviews ?? []).map((r) => ({ ...r, field: readableField(r.field) })),
  })

  const changedBy = (result) => !(result === null || result === undefined || result === 0 || result === false)
  const refOf = (result) => (result && typeof result === 'object' && typeof result.id === 'string' ? result.id : undefined)

  function blockedEntry(name, verdict) {
    return {
      op: 'screen_blocked',
      target: name,
      pattern_ids: verdict.violations.map((v) => v.patternId),
      review_ids: (verdict.reviews ?? []).map((r) => r.reasonId),
      violation_count: verdict.violations.length,
      policy,
    }
  }

  function commitWrite(name, args, extra = {}) {
    return rawStore.transaction(() => {
      const result = rawStore[name](...args)
      audit({
        op: changedBy(result) ? 'write_allowed' : 'write_noop',
        target: name,
        payload_sha256: name === 'deleteFiles' ? undefined : payloadHash(args),
        result_ref: refOf(result),
        count: typeof result === 'number' ? result : undefined,
        policy,
        ...extra,
      })
      return result
    })
  }

  const guarded = {}
  for (const name of readSet) {
    guarded[name] = (...args) => rawStore[name](...args)
  }
  for (const name of writeSet) {
    guarded[name] = (...args) => {
      const snap = snapshotOf(args)
      const verdict = snap.ok
        ? gate.screen(screenedView(name, snap.value))
        : { ok: false, decision: 'block', violations: [{ field: '(value)', patternId: 'unsupported-type', kind: 'unreadable' }], reviews: [] }
      if (verdict.decision === 'block' || (verdict.ok !== true && verdict.decision !== 'review')) {
        audit(blockedEntry(name, verdict))
        throw new ScreeningError(readable(verdict), name)
      }
      const payload = payloadHash(snap.value)
      if (writeMode === 'dry-run') {
        audit({ op: 'write_deferred', target: name, decision: verdict.decision, review_ids: (verdict.reviews ?? []).map((r) => r.reasonId), payload_sha256: payload, policy })
        throw new DeferredWriteError(name, verdict)
      }
      if (verdict.decision === 'review') {
        const reviewIds = verdict.reviews.map((r) => r.reasonId)
        const hold = rawStore.transaction(() => {
          const entry = rawStore.addPending({ target: name, args: snap.value, payload_sha256: payload, review_ids: [...new Set(reviewIds)], policy })
          audit({ op: 'write_held', target: name, hold_id: entry.id, review_ids: reviewIds, payload_sha256: payload, policy })
          return entry
        })
        throw new ReviewRequiredError(readable(verdict), name, hold.id)
      }
      return commitWrite(name, snap.value)
    }
  }
  // Lets tests and startup checks confirm what they were handed.
  Object.defineProperty(guarded, 'isGuarded', { value: true })

  const reviewerLabel = (reviewer) => checkReviewerLabel(gate, reviewer)

  // The `write_held` receipt for this hold, with the hash taken when the
  // write was screened and held.
  const heldReceipt = (held, hash) => rawStore.listAudit().some((e) => e.op === 'write_held' && e.hold_id === held.id && e.target === held.target && e.payload_sha256 === hash)

  // The reviewer desk. It is not part of the guarded store, so nothing that
  // holds only the guarded store (tools, record and memory logic, seeding)
  // can approve its own held writes.
  const review = Object.freeze({
    list() {
      return rawStore.listPending().map(({ id, target, review_ids, payload_sha256, policy: heldPolicy, at }) => ({ id, target, review_ids, payload_sha256, policy: heldPolicy, at }))
    },
    get(id) {
      return rawStore.getPending(id)
    },
    // Everything from reading the hold to committing it runs under the store
    // lock, so what is checked is what is written. The payload must hash to
    // the value in the hold and in its `write_held` receipt: a hold edited on
    // disk, even with its hash rewritten to match, is refused. Someone who
    // can rewrite the receipt as well can also edit the records directly, so
    // that is outside what this check can catch.
    approve(id, { reviewer } = {}) {
      const label = reviewerLabel(reviewer)
      if (writeMode === 'dry-run') throw new Error('approvals need a commit-mode runtime')
      const outcome = rawStore.transaction(() => {
        const held = rawStore.getPending(id)
        if (!held) throw new Error('hold not found or already resolved')
        if (!writeSet.has(held.target)) throw new Error('held write targets an unknown method')
        const hash = payloadHash(held.args)
        if (hash !== held.payload_sha256 || !heldReceipt(held, hash)) throw new Error('the held payload does not match the payload recorded when it was held')
        const verdict = gate.screen(screenedView(held.target, held.args))
        if (verdict.decision === 'block') return { blocked: verdict, target: held.target }
        rawStore.removePending(id)
        audit({ op: 'review_approved', target: held.target, hold_id: id, reviewer: label, review_ids: held.review_ids, payload_sha256: hash, policy })
        const result = commitWrite(held.target, held.args, { hold_id: id })
        return { hold_id: id, target: held.target, result_ref: refOf(result) ?? null }
      })
      // A payload the current policy blocks stays held and gets its own receipt.
      if (outcome.blocked) {
        audit(blockedEntry(outcome.target, outcome.blocked))
        throw new ScreeningError(readable(outcome.blocked), outcome.target)
      }
      return outcome
    },
    reject(id, { reviewer } = {}) {
      const label = reviewerLabel(reviewer)
      return rawStore.transaction(() => {
        const held = rawStore.removePending(id)
        if (!held) throw new Error('hold not found or already resolved')
        audit({ op: 'review_rejected', target: held.target, hold_id: id, reviewer: label, review_ids: held.review_ids, payload_sha256: held.payload_sha256, policy })
        return { hold_id: id, target: held.target }
      })
    },
    retract(ownerId, recordId, { reviewer, reason = 'retracted by reviewer' } = {}) {
      const label = reviewerLabel(reviewer)
      if (typeof reason !== 'string' || reason.length > 500) throw new Error('reason must be a string of at most 500 characters')
      // The reason is stored on the record, so it passes the gate like content.
      const verdict = gate.screen(reason)
      if (verdict.decision === 'block') throw new ScreeningError(readable(verdict), 'retract reason')
      if (verdict.decision !== 'allow') throw new Error('the retract reason would be held for review; write a plain reason')
      return rawStore.transaction(() => {
        const record = rawStore.setRecordStatus(ownerId, recordId, 'retracted', { reason, reviewer: label })
        if (!record) throw new Error('no record with that id')
        audit({ op: 'record_retracted', target: 'setRecordStatus', result_ref: record.id, reviewer: label, policy })
        return { id: record.id, status: record.status }
      })
    },
    audit,
  })

  return Object.freeze({ store: Object.freeze(guarded), review })
}

/** The guarded store alone, for callers that do not need the reviewer desk. */
export function createGuardedStore(rawStore, gate, options) {
  return createWriteGuard(rawStore, gate, options).store
}
