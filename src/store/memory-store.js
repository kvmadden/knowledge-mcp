// memory-store.js: the raw store. In-memory, with optional JSON-file persistence.
//
// Nothing outside src/store/ and the startup wiring in src/server.js may hold
// a reference to this object. Tools receive the guarded store instead
// (guarded-store.js), which screens every argument of every write method.
//
// Every method is classified as a read, a write or an internal method in
// CLASSIFICATION below. The guarded store refuses to wrap a store that has an
// unclassified method, so adding a write here without classifying it stops
// the server from starting. Internal methods are never handed to tools: only
// the guard calls them, to append audit entries, hold writes for review and
// commit a data change together with its audit entry.
//
// Persistence and several processes. Every change runs in a transaction that
// takes an exclusive lock file next to the store, rereads the file if another
// process changed it, applies the change to a new copy of the state, writes
// the whole state to a temporary file, flushes it and renames it into place.
// Reads reread the file when it changed. A failed write leaves the previous
// state in memory and on disk.

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import path from 'node:path'

import { matchesQuery } from '../lib/search.js'

export const READ_METHODS = Object.freeze([
  'getRecord',
  'listRecords',
  'searchRecords',
  'getFile',
  'listFiles',
  'listAudit',
  'snapshot',
])

export const WRITE_METHODS = Object.freeze([
  'insertRecord',
  'updateRecordMeta',
  'putFile',
  'deleteFiles',
  'moveFiles',
])

export const INTERNAL_METHODS = Object.freeze([
  'transaction',
  'appendAudit',
  'addPending',
  'getPending',
  'listPending',
  'removePending',
  'setRecordStatus',
  'purgeRecords',
  'redactAudit',
])

export const CLASSIFICATION = Object.freeze({ reads: READ_METHODS, writes: WRITE_METHODS, internal: INTERNAL_METHODS })

// Which arguments of a write carry new content. Deletion adds nothing, so its
// locators are not content-screened: a path that matches a listed pattern can
// always be removed. A move screens only its destinations.
export const SCREENED_ARGS = Object.freeze({
  deleteFiles: (args) => [args[0]],
  moveFiles: (args) => [args[0], Array.isArray(args[1]) ? args[1].map((move) => (Array.isArray(move) ? move[1] : move)) : args[1]],
})

export const STATE_VERSION = 2
export const RECORD_STATUSES = Object.freeze(['inbox', 'filed', 'archived', 'retracted'])
const HIDDEN_STATUSES = new Set(['retracted'])

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function clampLimit(limit, fallback = DEFAULT_LIMIT) {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return fallback
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function emptyState() {
  return { version: STATE_VERSION, nextRecord: 1, nextHold: 1, records: [], files: [], audit: [], pending: [] }
}

export class StoreFormatError extends Error {
  constructor(message) {
    super(`store file is not a valid knowledge-mcp store: ${message}`)
    this.name = 'StoreFormatError'
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Validate a parsed store and upgrade a version 1 store in memory. */
export function normalizeState(parsed) {
  if (!isObject(parsed)) throw new StoreFormatError('top level must be an object')
  const state = { ...emptyState(), ...parsed, version: STATE_VERSION }
  for (const key of ['records', 'files', 'audit', 'pending']) {
    if (!Array.isArray(state[key])) throw new StoreFormatError(`"${key}" must be an array`)
  }
  for (const key of ['nextRecord', 'nextHold']) {
    if (!Number.isInteger(state[key]) || state[key] < 1) throw new StoreFormatError(`"${key}" must be a positive integer`)
  }
  const ids = new Set()
  state.records.forEach((r, i) => {
    if (!isObject(r) || typeof r.id !== 'string' || !Number.isInteger(r.seq) || typeof r.owner_id !== 'string' || typeof r.text !== 'string') {
      throw new StoreFormatError(`records[${i}] is missing id, seq, owner_id or text`)
    }
    if (ids.has(r.id)) throw new StoreFormatError(`records[${i}] repeats an id`)
    ids.add(r.id)
    if (r.seq >= state.nextRecord) throw new StoreFormatError(`records[${i}] has a sequence number at or above nextRecord`)
  })
  const paths = new Set()
  state.files.forEach((f, i) => {
    if (!isObject(f) || typeof f.owner_id !== 'string' || typeof f.path !== 'string' || typeof f.content !== 'string') {
      throw new StoreFormatError(`files[${i}] is missing owner_id, path or content`)
    }
    const key = `${f.owner_id}\u0000${f.path}`
    if (paths.has(key)) throw new StoreFormatError(`files[${i}] repeats a path`)
    paths.add(key)
  })
  state.audit.forEach((e, i) => {
    if (!isObject(e) || typeof e.op !== 'string') throw new StoreFormatError(`audit[${i}] has no op`)
  })
  state.pending.forEach((p, i) => {
    if (!isObject(p) || typeof p.id !== 'string' || typeof p.target !== 'string' || !Array.isArray(p.args)) {
      throw new StoreFormatError(`pending[${i}] is missing id, target or args`)
    }
  })
  return state
}

// ── cross-process lock ──────────────────────────────────────────────────

const sleeper = new Int32Array(new SharedArrayBuffer(4))
const sleep = (ms) => Atomics.wait(sleeper, 0, 0, ms)

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export class StoreLockedError extends Error {
  constructor(file, holder) {
    super(`store is locked by another process${holder ? ` (pid ${holder})` : ''}; lock file ${file}`)
    this.name = 'StoreLockedError'
  }
}

class FileLock {
  #file
  #timeoutMs
  constructor(file, timeoutMs) {
    this.#file = file
    this.#timeoutMs = timeoutMs
  }

  acquire() {
    const deadline = Date.now() + this.#timeoutMs
    let holder = null
    for (;;) {
      try {
        const fd = openSync(this.#file, 'wx')
        try {
          writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
        } finally {
          closeSync(fd)
        }
        return
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
      holder = this.#removeIfStale()
      if (holder === 'removed') continue
      if (Date.now() > deadline) throw new StoreLockedError(this.#file, holder)
      sleep(5)
    }
  }

  release() {
    try {
      unlinkSync(this.#file)
    } catch {
      // already gone
    }
  }

  // A lock whose holder is this process (left by an interrupted write) or a
  // process that no longer exists is stale and is removed.
  #removeIfStale() {
    let raw
    try {
      raw = readFileSync(this.#file, 'utf8')
    } catch {
      return 'removed'
    }
    let info = null
    try {
      info = JSON.parse(raw)
    } catch {
      info = null
    }
    if (!info) {
      try {
        if (Date.now() - statSync(this.#file).mtimeMs < 2_000) return null
      } catch {
        return 'removed'
      }
    } else if (info.pid !== process.pid && pidAlive(info.pid)) {
      return info.pid
    }
    try {
      if (readFileSync(this.#file, 'utf8') === raw) unlinkSync(this.#file)
      return 'removed'
    } catch (error) {
      // Gone already means someone else removed it first. Any other error
      // (for example no permission) leaves the lock in place until the deadline.
      return error.code === 'ENOENT' ? 'removed' : null
    }
  }
}

// ── the store ───────────────────────────────────────────────────────────

let tmpCounter = 0

export class MemoryStore {
  #state
  #persistPath
  #now
  #verify
  #lock
  #signature = null
  #depth = 0

  /**
   * @param {object} [opts]
   * @param {string|null} [opts.persistPath]  JSON file; null keeps the store in memory
   * @param {() => string} [opts.now]          clock
   * @param {(state: object) => void} [opts.verify]  called with every state read from disk; throw to refuse it
   * @param {number} [opts.lockTimeoutMs]      how long a write waits for another process
   */
  constructor({ persistPath = null, now = () => new Date().toISOString(), verify = null, lockTimeoutMs = 10_000 } = {}) {
    this.#persistPath = persistPath
    this.#now = now
    this.#verify = verify
    this.#lock = persistPath ? new FileLock(`${persistPath}.lock`, lockTimeoutMs) : null
    this.#state = emptyState()
    if (persistPath && existsSync(persistPath)) this.#reload()
  }

  // ── internal: transactions, audit and holds ──────────────────────────

  /**
   * Run fn as one change: under the cross-process lock, against the latest
   * state, persisted once at the end. If fn throws or the write fails, the
   * previous state stays in place.
   */
  transaction(fn) {
    if (typeof fn !== 'function') throw new TypeError('transaction needs a function')
    if (this.#depth > 0) return fn()
    this.#lock?.acquire()
    try {
      this.#refresh()
      const before = this.#state
      this.#depth += 1
      let result
      try {
        result = fn()
      } catch (error) {
        this.#state = before
        throw error
      } finally {
        this.#depth -= 1
      }
      try {
        this.#persist()
      } catch (error) {
        this.#state = before
        throw error
      }
      return result
    } finally {
      this.#lock?.release()
    }
  }

  appendAudit(entry) {
    return this.transaction(() => {
      this.#state = { ...this.#state, audit: [...this.#state.audit, { ...clone(entry), at: this.#now() }] }
      return true
    })
  }

  addPending({ target, args, payload_sha256, review_ids, policy }) {
    return this.transaction(() => {
      const id = `hold_${String(this.#state.nextHold).padStart(4, '0')}`
      const entry = { id, target, args: clone(args), payload_sha256, review_ids: [...review_ids], policy, at: this.#now() }
      this.#state = { ...this.#state, nextHold: this.#state.nextHold + 1, pending: [...this.#state.pending, entry] }
      return clone(entry)
    })
  }

  getPending(id) {
    this.#refresh()
    return clone(this.#state.pending.find((p) => p.id === id)) ?? null
  }

  listPending() {
    this.#refresh()
    return clone(this.#state.pending)
  }

  removePending(id) {
    return this.transaction(() => {
      const found = this.#state.pending.find((p) => p.id === id)
      if (!found) return null
      this.#state = { ...this.#state, pending: this.#state.pending.filter((p) => p.id !== id) }
      return clone(found)
    })
  }

  setRecordStatus(ownerId, id, status, note = {}) {
    if (!RECORD_STATUSES.includes(status)) throw new Error('unknown record status')
    return this.transaction(() => {
      const record = this.#state.records.find((r) => r.owner_id === ownerId && r.id === id)
      if (!record) return null
      const next = { ...record, status, meta: { ...record.meta, status_change: { ...clone(note), status, at: this.#now() } }, updated_at: this.#now() }
      this.#state = { ...this.#state, records: this.#state.records.map((r) => (r === record ? next : r)) }
      return clone(next)
    })
  }

  /** Operator purge: remove records outright, text included. */
  purgeRecords(ids) {
    return this.transaction(() => {
      const drop = new Set(ids)
      const records = this.#state.records.filter((r) => !drop.has(r.id))
      const removed = this.#state.records.length - records.length
      if (removed) this.#state = { ...this.#state, records }
      return removed
    })
  }

  /** Operator purge: replace audit entries by position with a value-free marker. */
  redactAudit(indexes) {
    return this.transaction(() => {
      const drop = new Set(indexes)
      let redacted = 0
      const audit = this.#state.audit.map((entry, i) => {
        if (!drop.has(i)) return entry
        redacted += 1
        return { op: 'audit_redacted', at: typeof entry.at === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(entry.at) ? entry.at : this.#now() }
      })
      if (redacted) this.#state = { ...this.#state, audit }
      return redacted
    })
  }

  // ── reads ────────────────────────────────────────────────────────────

  getRecord(ownerId, id) {
    this.#refresh()
    return clone(this.#state.records.find((r) => r.owner_id === ownerId && r.id === id)) ?? null
  }

  #filtered(ownerId, { type, bucket, buckets, since, titledOnly, sourceApp, includeArchived = false, sortBy = 'updated_at' } = {}) {
    let rows = this.#state.records.filter((r) => r.owner_id === ownerId && !HIDDEN_STATUSES.has(r.status))
    if (!includeArchived) rows = rows.filter((r) => r.status !== 'archived')
    if (Array.isArray(buckets) && buckets.length) rows = rows.filter((r) => buckets.includes(r.bucket))
    else if (bucket) rows = rows.filter((r) => r.bucket === bucket)
    if (type) rows = rows.filter((r) => r.meta?.type === type)
    if (sourceApp) rows = rows.filter((r) => r.source_app === sourceApp)
    if (titledOnly) rows = rows.filter((r) => typeof r.meta?.title === 'string')
    const key = sortBy === 'created_at' ? 'created_at' : 'updated_at'
    if (since) rows = rows.filter((r) => r[key] >= since)
    return [...rows].sort((a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : b.seq - a.seq))
  }

  listRecords(ownerId, { limit, ...filter } = {}) {
    this.#refresh()
    return clone(this.#filtered(ownerId, filter).slice(0, clampLimit(limit)))
  }

  /** Searches every visible record, newest first, then caps the result count. */
  searchRecords(ownerId, { query, limit, ...filter } = {}) {
    this.#refresh()
    const cap = clampLimit(limit, 25)
    const out = []
    for (const row of this.#filtered(ownerId, { ...filter, sortBy: 'created_at' })) {
      if (!matchesQuery(query, searchableText(row))) continue
      out.push(row)
      if (out.length >= cap) break
    }
    return clone(out)
  }

  getFile(ownerId, filePath) {
    this.#refresh()
    return clone(this.#state.files.find((f) => f.owner_id === ownerId && f.path === filePath)) ?? null
  }

  listFiles(ownerId, prefix = '/') {
    this.#refresh()
    return clone(
      this.#state.files
        .filter((f) => f.owner_id === ownerId && f.path.startsWith(prefix))
        .sort((a, b) => (a.path < b.path ? -1 : 1)),
    )
  }

  listAudit() {
    this.#refresh()
    return clone(this.#state.audit)
  }

  snapshot() {
    this.#refresh()
    return clone(this.#state)
  }

  // ── writes ───────────────────────────────────────────────────────────

  insertRecord(row) {
    return this.transaction(() => {
      const at = this.#now()
      const seq = this.#state.nextRecord
      const record = {
        id: `rec_${String(seq).padStart(4, '0')}`,
        seq,
        owner_id: row.owner_id,
        text: row.text,
        bucket: row.bucket ?? null,
        source_app: row.source_app,
        provenance: {
          source: row.provenance?.source ?? row.source_app ?? 'unknown',
          observedAt: row.provenance?.observedAt ?? null,
          trust: row.provenance?.trust ?? 'unspecified',
          recordedAt: at,
        },
        status: row.status ?? 'inbox',
        tags: [...(row.tags ?? [])],
        meta: clone(row.meta ?? {}),
        created_at: at,
        updated_at: at,
      }
      this.#state = { ...this.#state, nextRecord: seq + 1, records: [...this.#state.records, record] }
      return clone(record)
    })
  }

  /** Shallow-merge into meta. A patch value of null removes that key. */
  updateRecordMeta(ownerId, id, patch) {
    return this.transaction(() => {
      const record = this.#state.records.find((r) => r.owner_id === ownerId && r.id === id)
      if (!record) return null
      const meta = { ...record.meta }
      for (const [key, value] of Object.entries(patch)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
        if (value === null) delete meta[key]
        else meta[key] = clone(value)
      }
      const next = { ...record, meta, updated_at: this.#now() }
      this.#state = { ...this.#state, records: this.#state.records.map((r) => (r === record ? next : r)) }
      return clone(next)
    })
  }

  /**
   * Create or replace a file. Versions only increase. When expectedVersion is
   * given and the file changed since the caller read it, the write is refused.
   */
  putFile(ownerId, filePath, content, expectedVersion) {
    return this.transaction(() => {
      const at = this.#now()
      const files = this.#state.files
      const existing = files.find((f) => f.owner_id === ownerId && f.path === filePath)
      if (Number.isInteger(expectedVersion) && existing && existing.version !== expectedVersion) {
        throw new Error('the file changed since it was read; read it again and retry')
      }
      if (!existing) assertFreePath(files, ownerId, filePath)
      let next
      if (existing) {
        const updated = {
          ...existing,
          content,
          version: (existing.version ?? 0) + 1,
          size_bytes: byteLength(content),
          updated_at: at,
          provenance: { ...existing.provenance, lastWrittenAt: at },
        }
        next = files.map((f) => (f === existing ? updated : f))
      } else {
        next = [...files, {
          owner_id: ownerId,
          path: filePath,
          content,
          provenance: { source: 'knowledge-mcp-memory', observedAt: null, recordedAt: at, lastWrittenAt: at, trust: 'unspecified' },
          version: 1,
          size_bytes: byteLength(content),
          created_at: at,
          updated_at: at,
        }]
      }
      this.#state = { ...this.#state, files: next }
      return true
    })
  }

  deleteFiles(ownerId, paths) {
    return this.transaction(() => {
      const drop = new Set(paths)
      const before = this.#state.files.length
      const files = this.#state.files.filter((f) => !(f.owner_id === ownerId && drop.has(f.path)))
      if (files.length === before) return 0
      this.#state = { ...this.#state, files }
      return before - files.length
    })
  }

  /** Apply all moves or none. Sources must exist and be distinct; destinations must be distinct and free. */
  moveFiles(ownerId, moves) {
    return this.transaction(() => {
      const own = this.#state.files.filter((f) => f.owner_id === ownerId)
      const byPath = new Map(own.map((f) => [f.path, f]))
      const sources = new Set()
      const targets = new Set()
      for (const [from, to] of moves) {
        if (!byPath.has(from)) throw new Error('move source missing')
        if (sources.has(from)) throw new Error('move source repeated')
        if (targets.has(to)) throw new Error('move destination repeated')
        sources.add(from)
        targets.add(to)
      }
      for (const to of targets) if (byPath.has(to) && !sources.has(to)) throw new Error('move destination already exists')
      const at = this.#now()
      const moved = new Map(moves.map(([from, to]) => [from, to]))
      const files = this.#state.files.map((f) => (f.owner_id === ownerId && moved.has(f.path) ? { ...f, path: moved.get(f.path), updated_at: at } : f))
      const finalPaths = files.filter((f) => f.owner_id === ownerId).map((f) => f.path)
      assertNamespace(finalPaths)
      this.#state = { ...this.#state, files }
      return moves.length
    })
  }

  // ── persistence ──────────────────────────────────────────────────────

  #readSignature() {
    try {
      const s = statSync(this.#persistPath)
      return `${s.ino}:${s.size}:${s.mtimeMs}`
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  #reload() {
    const signature = this.#readSignature()
    if (signature === null) return
    let parsed
    try {
      parsed = JSON.parse(readFileSync(this.#persistPath, 'utf8'))
    } catch (error) {
      throw new StoreFormatError(error instanceof SyntaxError ? 'it is not valid JSON' : error.message)
    }
    const state = normalizeState(parsed)
    this.#verify?.(state)
    this.#state = state
    this.#signature = signature
  }

  // Another process may have written since this one last read the file.
  #refresh() {
    if (!this.#persistPath || this.#depth > 0) return
    if (this.#readSignature() !== this.#signature) this.#reload()
  }

  #persist() {
    if (!this.#persistPath) return
    mkdirSync(path.dirname(this.#persistPath), { recursive: true })
    tmpCounter += 1
    const tmp = `${this.#persistPath}.${process.pid}.${tmpCounter}.tmp`
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, JSON.stringify(this.#state, null, 2))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      renameSync(tmp, this.#persistPath)
    } catch (error) {
      try {
        unlinkSync(tmp)
      } catch {
        // nothing to clean
      }
      throw error
    }
    this.#signature = this.#readSignature()
  }
}

function assertFreePath(files, ownerId, filePath) {
  for (const f of files) {
    if (f.owner_id !== ownerId) continue
    if (f.path.startsWith(`${filePath}/`)) throw new Error('a directory already exists at this path')
    if (filePath.startsWith(`${f.path}/`)) throw new Error('a file already exists at a parent of this path')
  }
}

function assertNamespace(paths) {
  const set = new Set(paths)
  for (const p of paths) {
    let at = p.lastIndexOf('/')
    while (at > 0) {
      if (set.has(p.slice(0, at))) throw new Error('a file would also be a directory')
      at = p.lastIndexOf('/', at - 1)
    }
  }
}

function byteLength(text) {
  return new TextEncoder().encode(text).length
}

function searchableText(record) {
  return [record.text, record.meta?.title, record.meta?.summary, ...(record.tags ?? [])]
    .filter((v) => typeof v === 'string')
    .join('\n')
}
