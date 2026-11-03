// maintenance.js: operator tools for a store file the server refuses to open.
//
// A store refuses to load when an item matches a block rule, for example
// after the deny-list was tightened or the file was edited by hand. scanStore
// lists those items by location and rule id, never by value. purgeStore
// removes blocking records, files and held writes, replaces blocking audit
// entries with a value-free `audit_redacted` marker, and records one
// `store_purged` entry naming the reviewer and the counts.

import { CLASSIFICATION, MemoryStore, SCREENED_ARGS } from './memory-store.js'
import { createWriteGuard } from './guarded-store.js'

function inspect(state, gate) {
  const blocking = []
  const review = []
  const visit = (collection, index, value, ref) => {
    const verdict = gate.screen(value)
    const ids = verdict.decision === 'block' ? verdict.violations.map((v) => v.patternId) : verdict.reviews.map((r) => r.reasonId)
    const entry = { collection, index, ref, rule_ids: [...new Set(ids)] }
    if (verdict.decision === 'block') blocking.push(entry)
    else if (verdict.decision === 'review') review.push(entry)
  }
  state.records.forEach((r, i) => visit('records', i, r, r.id))
  state.files.forEach((f, i) => visit('files', i, f, null))
  state.pending.forEach((p, i) => visit('pending', i, p.args, p.id))
  state.audit.forEach((e, i) => visit('audit', i, e, null))
  return { blocking, review }
}

/** Report what in a store file blocks loading, or would be held for review. */
export function scanStore(storePath, gate) {
  const raw = new MemoryStore({ persistPath: storePath })
  const state = raw.snapshot()
  const { blocking, review } = inspect(state, gate)
  return {
    records: state.records.length,
    files: state.files.length,
    pending: state.pending.length,
    audit: state.audit.length,
    blocking,
    review,
  }
}

/** Remove what blocks loading. Without apply, report what would change. */
export function purgeStore(storePath, gate, { apply = false, reviewer } = {}) {
  const raw = new MemoryStore({ persistPath: storePath })
  const { blocking } = inspect(raw.snapshot(), gate)
  const counts = { records: 0, files: 0, pending: 0, audit: 0 }
  for (const item of blocking) counts[item.collection] += 1
  if (!apply || blocking.length === 0) return { applied: false, counts, blocking }
  if (typeof reviewer !== 'string' || !reviewer.trim()) throw new Error('purge needs --reviewer <label>')
  const { review } = createWriteGuard(raw, gate, { ...CLASSIFICATION, screenedArgs: SCREENED_ARGS })
  raw.transaction(() => {
    const state = raw.snapshot()
    const drop = (collection) => new Set(blocking.filter((b) => b.collection === collection).map((b) => b.index))
    const recordDrop = drop('records')
    const fileDrop = drop('files')
    const pendingDrop = drop('pending')
    const auditDrop = drop('audit')
    // Rebuild through internal methods so the change and its receipt commit together.
    for (const [i, file] of state.files.entries()) if (fileDrop.has(i)) raw.deleteFiles(file.owner_id, [file.path])
    for (const [i, held] of state.pending.entries()) if (pendingDrop.has(i)) raw.removePending(held.id)
    raw.purgeRecords(state.records.filter((_, i) => recordDrop.has(i)).map((r) => r.id))
    raw.redactAudit([...auditDrop])
    review.audit({ op: 'store_purged', reviewer, counts, policy: gate.policyId })
  })
  return { applied: true, counts, blocking }
}
