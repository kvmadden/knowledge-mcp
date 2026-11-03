// Regression tests for the availability and data-loss defects found in the
// November 2026 review: restart at scale, search beyond 200 records, two
// processes on one store file, failed persistence, and audit receipts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { buildRuntime } from '../src/server.js'
import { CLASSIFICATION, MemoryStore, SCREENED_ARGS, StoreLockedError } from '../src/store/memory-store.js'
import { createWriteGuard } from '../src/store/guarded-store.js'
import { createGate, ScreeningError } from '../src/screening/screen.js'
import { loadGate } from '../src/screening/load-deny-list.js'
import { SAMPLES } from './_helpers.js'

const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url))

function tmp() {
  const dir = mkdtempSync(path.join(tmpdir(), 'knowledge-reliability-'))
  return { dir, file: (name) => path.join(dir, name), done: () => rmSync(dir, { recursive: true, force: true }) }
}

function bigState(records, files, fileChars) {
  const at = '2026-11-03T12:00:00.000Z'
  return {
    version: 2,
    nextRecord: records + 1,
    nextHold: 1,
    records: Array.from({ length: records }, (_, i) => ({
      id: `rec_${String(i + 1).padStart(4, '0')}`, seq: i + 1, owner_id: 'local-owner', text: `Synthetic operations note ${i + 1} about the weekly digest.`,
      bucket: null, source_app: 'knowledge-mcp', provenance: { source: 'knowledge-mcp', observedAt: null, trust: 'unspecified', recordedAt: at },
      status: 'inbox', tags: ['digest'], meta: { type: 'note' }, created_at: at, updated_at: at,
    })),
    files: Array.from({ length: files }, (_, i) => ({
      owner_id: 'local-owner', path: `/notes/f${i}.md`, content: 'Synthetic paragraph about queue staffing. '.repeat(Math.ceil(fileChars / 42)).slice(0, fileChars),
      provenance: { source: 'knowledge-mcp-memory', observedAt: null, recordedAt: at, lastWrittenAt: at, trust: 'unspecified' }, version: 1, size_bytes: fileChars, created_at: at, updated_at: at,
    })),
    audit: [],
    pending: [],
  }
}

test('a store far past the old 833-record and 1,000,000-character limits restarts', () => {
  const t = tmp()
  try {
    const storePath = t.file('store.json')
    writeFileSync(storePath, JSON.stringify(bigState(2_000, 12, 100_000)))
    const runtime = buildRuntime({ storePath })
    assert.equal(runtime.snapshot().records.length, 2_000)
    assert.equal(runtime.snapshot().files.length, 12)
    assert.equal(runtime.ctx.records.create({ text: 'one more after restart' }).id, 'rec_2001')
    assert.equal(buildRuntime({ storePath }).snapshot().records.length, 2_001)
  } finally {
    t.done()
  }
})

test('a version 1 store file (no hold queue, no version) still loads', () => {
  const t = tmp()
  try {
    const storePath = t.file('store.json')
    const v1 = bigState(2, 0, 0)
    delete v1.version
    delete v1.nextHold
    delete v1.pending
    writeFileSync(storePath, JSON.stringify(v1))
    const runtime = buildRuntime({ storePath })
    assert.equal(runtime.snapshot().records.length, 2)
    assert.deepEqual(runtime.snapshot().pending, [])
  } finally {
    t.done()
  }
})

test('a malformed store file is refused with a reason, not a parser message', () => {
  const t = tmp()
  try {
    const storePath = t.file('store.json')
    writeFileSync(storePath, '')
    assert.throws(() => buildRuntime({ storePath }), /not a valid knowledge-mcp store/)
    writeFileSync(storePath, JSON.stringify({ records: [{ id: 'rec_0001' }], files: [], audit: [], nextRecord: 2 }))
    assert.throws(() => buildRuntime({ storePath }), /records\[0\] is missing/)
  } finally {
    t.done()
  }
})

test('search reaches records older than the newest 200', () => {
  const runtime = buildRuntime()
  runtime.ctx.records.create({ text: 'needle-oldest synthetic record' })
  for (let i = 0; i < 250; i += 1) runtime.ctx.records.create({ text: `filler ${i}` })
  assert.deepEqual(runtime.ctx.records.search({ query: 'needle-oldest' }).map((r) => r.id), ['rec_0001'])
  assert.equal(runtime.ctx.records.search({ query: 'filler', limit: 5 }).length, 5)
})

test('two runtimes on one store file keep every write, with unique ids, and each sees the other', () => {
  const t = tmp()
  try {
    const storePath = t.file('store.json')
    const a = buildRuntime({ storePath })
    const b = buildRuntime({ storePath })
    const first = a.ctx.records.create({ text: 'written by A' })
    const second = b.ctx.records.create({ text: 'written by B' })
    const third = a.ctx.records.create({ text: 'written by A again' })
    assert.deepEqual([first.id, second.id, third.id], ['rec_0001', 'rec_0002', 'rec_0003'])
    assert.equal(a.ctx.records.get('rec_0002').text, 'written by B')
    const disk = JSON.parse(readFileSync(storePath, 'utf8'))
    assert.equal(disk.records.length, 3)
    assert.equal(disk.audit.filter((e) => e.op === 'write_allowed').length, 3)
  } finally {
    t.done()
  }
})

test('two processes writing at the same time lose nothing', async () => {
  const t = tmp()
  try {
    const storePath = t.file('store.json')
    const writer = `
      const { buildRuntime } = await import(${JSON.stringify(SERVER)})
      const runtime = buildRuntime({ storePath: process.argv[1] })
      for (let i = 0; i < 40; i += 1) runtime.ctx.records.create({ text: 'process ' + process.argv[2] + ' note ' + i })
    `
    const run = (label) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', writer, storePath, label], { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (d) => { stderr += d })
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))))
    })
    await Promise.all([run('one'), run('two')])
    const state = JSON.parse(readFileSync(storePath, 'utf8'))
    assert.equal(state.records.length, 80)
    assert.equal(new Set(state.records.map((r) => r.id)).size, 80)
    assert.equal(state.audit.filter((e) => e.op === 'write_allowed').length, 80)
  } finally {
    t.done()
  }
})

test('a lock left by a dead process is recovered, and a live holder makes a write wait and then fail cleanly', () => {
  const t = tmp()
  try {
    const storePath = t.file('store.json')
    writeFileSync(`${storePath}.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }))
    const runtime = buildRuntime({ storePath, lockTimeoutMs: 200 })
    runtime.ctx.records.create({ text: 'after a stale lock' })
    assert.equal(runtime.snapshot().records.length, 1)
    writeFileSync(`${storePath}.lock`, JSON.stringify({ pid: process.ppid, at: Date.now() }))
    assert.throws(() => runtime.ctx.records.create({ text: 'while another process holds the lock' }), StoreLockedError)
    rmSync(`${storePath}.lock`)
    assert.equal(buildRuntime({ storePath }).snapshot().records.length, 1)
  } finally {
    t.done()
  }
})

test('a change that fails partway leaves the earlier state in memory and on disk', () => {
  const t = tmp()
  try {
    const store = new MemoryStore({ persistPath: t.file('store.json') })
    store.insertRecord({ owner_id: 'o', text: 'kept', source_app: 't' })
    assert.throws(() => store.transaction(() => {
      store.insertRecord({ owner_id: 'o', text: 'never saved', source_app: 't' })
      throw new Error('disk full after the change was applied')
    }), /disk full/)
    assert.equal(store.getRecord('o', 'rec_0002'), null)
    assert.equal(JSON.parse(readFileSync(t.file('store.json'), 'utf8')).records.length, 1)
    assert.equal(store.insertRecord({ owner_id: 'o', text: 'next', source_app: 't' }).id, 'rec_0002')
  } finally {
    t.done()
  }
})

// This one fails at the lock, before any write. Failures after the lock is
// taken (write, flush and rename) are injected in test/review-round-2.test.js.
test('a store whose directory turned read-only refuses the next write and changes nothing', { skip: process.getuid?.() === 0 ? 'root ignores directory permissions' : false }, () => {
  const t = tmp()
  try {
    const storePath = t.file('store.json')
    const store = new MemoryStore({ persistPath: storePath, lockTimeoutMs: 100 })
    store.insertRecord({ owner_id: 'o', text: 'kept', source_app: 't' })
    chmodSync(t.dir, 0o555)
    try {
      assert.throws(() => store.insertRecord({ owner_id: 'o', text: 'never saved', source_app: 't' }))
    } finally {
      chmodSync(t.dir, 0o755)
    }
    assert.equal(store.snapshot().records.length, 1)
    assert.equal(JSON.parse(readFileSync(storePath, 'utf8')).records.length, 1)
  } finally {
    t.done()
  }
})

test('a data change and its audit entry commit together or not at all', () => {
  class FailingAudit extends MemoryStore {
    appendAudit() {
      throw new Error('audit storage unavailable')
    }
  }
  const raw = new FailingAudit()
  const { store } = createWriteGuard(raw, loadGate(), { ...CLASSIFICATION, screenedArgs: SCREENED_ARGS })
  assert.throws(() => store.insertRecord({ owner_id: 'o', text: 'needs a receipt', source_app: 't' }), /audit storage unavailable/)
  assert.equal(raw.snapshot().records.length, 0)
})

test('a deny-list whose pattern matches its own id still leaves a receipt for every block', () => {
  const runtime = buildRuntime({ denyList: { patterns: [{ id: 'ssn', pattern: '\\bssn\\b', flags: 'i' }] } })
  assert.throws(() => runtime.ctx.records.create({ text: 'SSN on file' }), ScreeningError)
  const audit = runtime.snapshot().audit
  assert.equal(audit.length, 1)
  assert.equal(audit[0].op, 'screen_blocked')
  assert.deepEqual(audit[0].pattern_ids, ['ssn'])
})

test('a write that changes nothing is audited as a no-op, not as allowed', () => {
  const runtime = buildRuntime()
  assert.throws(() => runtime.ctx.records.pin({ id: 'rec_9999' }), /no record/)
  assert.deepEqual(runtime.snapshot().audit.map((e) => e.op), ['write_noop'])
})

test('system fields of audit entries are checked by format, so a payload hash never blocks a restart', () => {
  const t = tmp()
  try {
    const storePath = t.file('store.json')
    buildRuntime({ storePath }).ctx.records.create({ text: 'clean note' })
    const state = JSON.parse(readFileSync(storePath, 'utf8'))
    state.audit[0].payload_sha256 = `a${'4111111111111111'}${'b'.repeat(47)}`
    writeFileSync(storePath, JSON.stringify(state))
    assert.equal(buildRuntime({ storePath }).snapshot().audit.length, 1)
    state.audit[0].note = 'an unexpected free-text field'
    writeFileSync(storePath, JSON.stringify(state))
    assert.throws(() => buildRuntime({ storePath }), /unexpected-audit-field/)
  } finally {
    t.done()
  }
})

test('the audit log is screened at load, and the operator purge clears what blocks it', async () => {
  const t = tmp()
  try {
    const storePath = t.file('store.json')
    buildRuntime({ storePath }).ctx.records.create({ text: 'clean note' })
    const state = JSON.parse(readFileSync(storePath, 'utf8'))
    state.audit.push({ op: 'write_allowed', target: 'insertRecord', path: `/notes/${SAMPLES['email-address']}.md`, at: '2026-11-01T00:00:00.000Z' })
    writeFileSync(storePath, JSON.stringify(state))
    assert.throws(() => buildRuntime({ storePath }), /store load rejected by screening: field "audit\[1\]\.path" matched "email-address"/)
    const { purgeStore, scanStore } = await import('../src/store/maintenance.js')
    const gate = loadGate()
    assert.deepEqual(scanStore(storePath, gate).blocking.map((b) => [b.collection, b.index]), [['audit', 1]])
    assert.equal(purgeStore(storePath, gate).applied, false, 'without --apply nothing changes')
    assert.throws(() => purgeStore(storePath, gate, { apply: true }), /reviewer/)
    assert.equal(purgeStore(storePath, gate, { apply: true, reviewer: 'operator-test' }).applied, true)
    const after = buildRuntime({ storePath }).snapshot()
    assert.ok(!JSON.stringify(after).includes(SAMPLES['email-address']))
    assert.deepEqual(after.audit.slice(-2).map((e) => e.op), ['audit_redacted', 'store_purged'])
    assert.equal(after.records.length, 1)
  } finally {
    t.done()
  }
})

test('the guarded store writes exactly the snapshot it screened, whatever a getter returns later', () => {
  const raw = new MemoryStore()
  const { store } = createWriteGuard(raw, loadGate(), { ...CLASSIFICATION, screenedArgs: SCREENED_ARGS })
  let reads = 0
  const row = { owner_id: 'o', source_app: 't', get text() { reads += 1; return reads === 1 ? 'clean' : `SSN ${SAMPLES['us-ssn-format']}` } }
  store.insertRecord(row)
  assert.equal(raw.snapshot().records[0].text, 'clean')
  assert.ok(!JSON.stringify(raw.snapshot()).includes(SAMPLES['us-ssn-format']))
  const list = ['ok']
  list.contact = SAMPLES['email-address']
  assert.throws(() => store.insertRecord({ owner_id: 'o', text: 'x', source_app: 't', meta: { list } }), ScreeningError)
  assert.equal(raw.snapshot().records.length, 1)
})

test('every read method leaves the store unchanged, so a write cannot hide among the reads', () => {
  const runtime = buildRuntime({ seedPath: fileURLToPath(new URL('../data/seed.json', import.meta.url)) })
  const before = JSON.stringify(runtime.snapshot())
  const calls = {
    getRecord: ['local-owner', 'rec_0001'],
    listRecords: ['local-owner', { limit: 5 }],
    searchRecords: ['local-owner', { query: 'digest' }],
    getFile: ['local-owner', '/preferences/writing-style.md'],
    listFiles: ['local-owner', '/'],
    listAudit: [],
    snapshot: [],
  }
  assert.deepEqual(Object.keys(calls).sort(), [...CLASSIFICATION.reads].sort())
  for (const [name, args] of Object.entries(calls)) runtime.store[name](...args)
  assert.equal(JSON.stringify(runtime.snapshot()), before)
})

test('a deny-list pattern that is slow on long input cannot be compiled', () => {
  const oldEmail = '[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\\.[A-Z0-9-]+)*\\.[A-Z]{2,}'
  assert.throws(() => createGate([{ id: 'old-email', pattern: oldEmail, flags: 'i' }]), /too slow on long input/)
})

test('screening time stays linear on long tokens that stalled the old email pattern', () => {
  const gate = loadGate()
  const hex = Array.from({ length: 200_000 }, (_, i) => '0123456789abcdef'[(i * 7 + 3) % 16]).join('')
  const started = performance.now()
  const verdict = gate.screen({ text: hex })
  const ms = performance.now() - started
  assert.ok(ms < 2_000, `200,000 hex characters took ${Math.round(ms)} ms`)
  assert.equal(verdict.decision, 'review', 'a long opaque block is held, because the gate cannot read it')
  assert.deepEqual(verdict.reviews.map((r) => r.reasonId), ['unreadable-encoded-content'])
})
