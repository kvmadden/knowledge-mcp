// maintenance.js: operator tools for a store file the server refuses to open.
//
// A store refuses to load when an item matches a block rule or an audit entry
// does not fit the audit schema, for example after the deny-list was
// tightened or the file was edited by hand. scanStore lists those items by
// location and rule id, never by value. purgeStore removes blocking records,
// files and held writes, replaces blocking audit entries with a value-free
// `audit_redacted` marker, and records one `store_purged` entry naming the
// reviewer and the counts.
//
// The purge scans and removes under one lock and removes by identity (record
// id, owner and path, hold id), so a write by another process between a scan
// and the removal cannot shift what is removed.

import { CLASSIFICATION, MemoryStore, SCREENED_ARGS } from './memory-store.js'
import { checkReviewerLabel, createWriteGuard } from './guarded-store.js'
import { auditFields } from './audit-format.js'

function inspect(state, gate) {
  const blocking = []
  const review = []
  const visit = (item, value) => {
    const verdict = gate.screen(value)
    const ids = verdict.decision === 'block' ? verdict.violations.map((v) => v.patternId) : verdict.reviews.map((r) => r.reasonId)
    const entry = { ...item, rule_ids: [...new Set(ids)] }
    if (verdict.decision === 'block') blocking.push(entry)
    else if (verdict.decision === 'review') review.push(entry)
  }
  state.records.forEach((r, i) => visit({ collection: 'records', index: i, ref: r.id }, r))
  state.files.forEach((f, i) => visit({ collection: 'files', index: i, ref: null, owner_id: f.owner_id, path: f.path }, f))
  state.pending.forEach((p, i) => visit({ collection: 'pending', index: i, ref: p.id }, p.args))
  // An audit entry is checked against the audit schema first, then its free
  // text is content-screened.
  state.audit.forEach((e, i) => {
    const { unexpected, freeText } = auditFields(e)
    if (unexpected.length) {
      blocking.push({ collection: 'audit', index: i, ref: null, rule_ids: ['unexpected-audit-field'] })
      return
    }
    if (Object.keys(freeText).length) visit({ collection: 'audit', index: i, ref: null }, freeText)
  })
  return { blocking, review }
}

// Locations and rule ids only. A file path can itself hold a blocked value.
const shown = (items) => items.map(({ collection, index, ref, rule_ids }) => ({ collection, index, ref, rule_ids }))

function countsOf(blocking) {
  const counts = { records: 0, files: 0, pending: 0, audit: 0 }
  for (const item of blocking) counts[item.collection] += 1
  return counts
}

/** Report what in a store file blocks loading, or would be held for review. */
export function scanStore(storePath, gate) {
  const raw = new MemoryStore({ persistPath: storePath })
  const state = raw.rawSnapshot()
  const { blocking, review } = inspect(state, gate)
  return {
    records: state.records.length,
    files: state.files.length,
    pending: state.pending.length,
    audit: state.audit.length,
    blocking: shown(blocking),
    review: shown(review),
  }
}

/** Remove what blocks loading. Without apply, report what would change. */
export function purgeStore(storePath, gate, { apply = false, reviewer } = {}) {
  const raw = new MemoryStore({ persistPath: storePath })
  if (!apply) {
    const { blocking } = inspect(raw.rawSnapshot(), gate)
    return { applied: false, counts: countsOf(blocking), blocking: shown(blocking) }
  }
  // The label goes into the audit log, so it must pass the same check as
  // any reviewer label, or the next load would refuse the store again.
  const label = checkReviewerLabel(gate, reviewer)
  const { review } = createWriteGuard(raw, gate, { ...CLASSIFICATION, screenedArgs: SCREENED_ARGS })
  return raw.transaction(() => {
    const { blocking } = inspect(raw.rawSnapshot(), gate)
    const counts = countsOf(blocking)
    if (blocking.length === 0) return { applied: false, counts, blocking: [] }
    for (const item of blocking) {
      if (item.collection === 'files') raw.deleteFiles(item.owner_id, [item.path])
      else if (item.collection === 'pending') raw.removePending(item.ref)
    }
    raw.purgeRecords(blocking.filter((b) => b.collection === 'records').map((b) => b.ref))
    // Audit positions are stable here: the scan and this change run under
    // the same lock, and none of the removals above add audit entries.
    raw.redactAudit(blocking.filter((b) => b.collection === 'audit').map((b) => b.index))
    review.audit({ op: 'store_purged', reviewer: label, counts, policy: gate.policyId })
    return { applied: true, counts, blocking: shown(blocking) }
  })
}
