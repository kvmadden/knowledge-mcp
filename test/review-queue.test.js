// The hold queue: what the gate cannot judge waits for a person, outside MCP.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildRuntime, TOOLS } from '../src/server.js'
import { payloadHash } from '../src/store/guarded-store.js'
import { connect, dataOf, newRuntime, textOf } from './_helpers.js'

const RULE = { text: 'Protocol draft: route unresolved refill requests to a pharmacist before outreach.', type: 'rule' }

test('an MCP write the gate cannot judge is held: the tool reports it, nothing is stored and reads do not see it', async () => {
  const runtime = newRuntime()
  const { client, close } = await connect(runtime)
  try {
    const out = await client.callTool({ name: 'records.create', arguments: RULE })
    assert.equal(out.isError, true)
    assert.match(textOf(out), /held for review: "clinical-assertion".*Nothing was written\. Hold id hold_0001/)
    assert.equal(runtime.snapshot().records.length, 0)
    const listed = await client.callTool({ name: 'records.list', arguments: {} })
    assert.match(textOf(listed), /No records matched/)
    const searched = await client.callTool({ name: 'inbox.search', arguments: { query: 'refill' } })
    assert.match(textOf(searched), /No rows matched/)
  } finally {
    await close()
  }
  assert.deepEqual(runtime.review.list().map((h) => [h.id, h.target, h.review_ids]), [['hold_0001', 'insertRecord', ['clinical-assertion']]])
  assert.equal(runtime.snapshot().audit.at(-1).op, 'write_held')
})

test('approval writes exactly the held payload, once, with the reviewer named in the audit', () => {
  const runtime = newRuntime()
  assert.throws(() => runtime.ctx.records.create(RULE), /held for review/)
  const [held] = runtime.review.list()
  const outcome = runtime.review.approve(held.id, { reviewer: 'pharmacist-reviewer-1' })
  assert.equal(outcome.result_ref, 'rec_0001')
  assert.equal(runtime.ctx.records.get('rec_0001').text, RULE.text)
  const audit = runtime.snapshot().audit
  const approved = audit.find((e) => e.op === 'review_approved')
  const written = audit.find((e) => e.op === 'write_allowed')
  assert.equal(approved.reviewer, 'pharmacist-reviewer-1')
  assert.equal(approved.payload_sha256, held.payload_sha256)
  assert.equal(written.payload_sha256, held.payload_sha256)
  assert.equal(written.hold_id, held.id)
  assert.equal(runtime.review.list().length, 0)
  assert.throws(() => runtime.review.approve(held.id, { reviewer: 'pharmacist-reviewer-1' }), /not found or already resolved/)
})

test('rejection leaves nothing written and is audited; a reviewer label is required and screened', () => {
  const runtime = newRuntime()
  assert.throws(() => runtime.ctx.records.create(RULE), /held for review/)
  const [held] = runtime.review.list()
  assert.throws(() => runtime.review.reject(held.id, {}), /reviewer label/)
  assert.throws(() => runtime.review.reject(held.id, { reviewer: 'jordan.sample@example.com' }), /listed pattern/)
  runtime.review.reject(held.id, { reviewer: 'pharmacist-reviewer-2' })
  assert.equal(runtime.snapshot().records.length, 0)
  assert.equal(runtime.snapshot().audit.at(-1).op, 'review_rejected')
})

test('holds survive a restart, and a payload edited on disk without its hash cannot be approved', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knowledge-holds-'))
  try {
    const storePath = path.join(dir, 'store.json')
    assert.throws(() => buildRuntime({ storePath }).ctx.records.create(RULE), /held for review/)
    assert.throws(() => buildRuntime({ storePath }).ctx.records.create({ ...RULE, text: `${RULE.text} Second draft.` }), /held for review/)
    const state = JSON.parse(readFileSync(storePath, 'utf8'))
    state.pending[1].args[0].text = 'A different protocol than the one that was screened and held.'
    writeFileSync(storePath, JSON.stringify(state))
    const later = buildRuntime({ storePath })
    assert.equal(later.review.list().length, 2)
    assert.throws(() => later.review.approve('hold_0002', { reviewer: 'pharmacist-reviewer-1' }), /recorded when it was held/)
    later.review.approve('hold_0001', { reviewer: 'pharmacist-reviewer-1' })
    assert.equal(buildRuntime({ storePath }).snapshot().records[0].text, RULE.text)
    assert.equal(payloadHash(state.pending[0].args), state.pending[0].payload_sha256)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no MCP tool can approve, reject or retract', () => {
  for (const tool of TOOLS) assert.ok(!/approve|reject|retract|review|purge/i.test(tool.name), tool.name)
})

test('a retracted record disappears from every read path, stays inspectable by id, and is audited', async () => {
  const runtime = newRuntime()
  const record = runtime.ctx.records.logDecision({ title: 'Use the weekly digest template' })
  runtime.ctx.records.create({ text: 'unrelated note' })
  runtime.review.retract(record.id, { reviewer: 'operator-1', reason: 'superseded by the October template' })
  assert.deepEqual(runtime.ctx.records.list().map((r) => r.id), ['rec_0002'])
  assert.deepEqual(runtime.ctx.records.recent().map((r) => r.id), ['rec_0002'])
  assert.deepEqual(runtime.ctx.records.recentDecisions(), [])
  assert.deepEqual(runtime.ctx.records.search({ query: 'digest' }), [])
  assert.equal(runtime.ctx.records.get(record.id).status, 'retracted')
  const entry = runtime.snapshot().audit.at(-1)
  assert.deepEqual([entry.op, entry.result_ref, entry.reviewer], ['record_retracted', record.id, 'operator-1'])
  const { client, close } = await connect(runtime)
  try {
    const resource = await client.readResource({ uri: 'knowledge://records/recent-decisions' })
    assert.equal(JSON.parse(resource.contents[0].text).count, 0)
  } finally {
    await close()
  }
})

test('dry-run reports what would be held without storing a hold', () => {
  const runtime = newRuntime({ writeMode: 'dry-run' })
  const before = dataOf(runtime.snapshot())
  assert.throws(() => runtime.ctx.records.create(RULE), /deferred by dry-run: it would be held for review \("clinical-assertion"\)/)
  assert.equal(runtime.snapshot().pending.length, 0)
  assert.equal(dataOf(runtime.snapshot()), before)
  const entry = runtime.snapshot().audit.at(-1)
  assert.deepEqual([entry.op, entry.decision, entry.review_ids], ['write_deferred', 'review', ['clinical-assertion']])
})
