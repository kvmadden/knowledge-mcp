// Kevin Madden's ruling, 3 November 2026: deleting, renaming, overwriting or
// editing an existing protocol waits for a person's approval, like any other
// held write. A protocol is a memory file with "protocol" in the name of the
// file or of a folder above it.
import test from 'node:test'
import assert from 'node:assert/strict'

import { isProtocolPath } from '../src/store/guarded-store.js'
import { connect, newRuntime, textOf } from './_helpers.js'

const PROTOCOL = '/memories/protocols/anticoagulation.md'
const BODY = 'Anticoagulation checklist for the clinic team, updated every Friday.'

function withProtocol(opts) {
  const runtime = newRuntime(opts)
  assert.match(runtime.ctx.memory.create({ path: PROTOCOL, file_text: BODY }), /created/)
  return runtime
}
const fileAt = (runtime, sub) => runtime.snapshot().files.find((f) => f.path === sub) ?? null
const lastOps = (runtime, n) => runtime.snapshot().audit.slice(-n).map((e) => e.op)

test('what counts as a protocol path', () => {
  for (const p of ['/protocols/a.md', '/clinic/protocols/a.md', '/anticoagulation-protocol.md', '/Protocols/A.md', '/protocol/a.md']) assert.equal(isProtocolPath(p), true, p)
  // Full-width and Cyrillic look-alike letters still spell the word.
  for (const p of ['/flush-\uff50\uff52\uff4f\uff54\uff4f\uff43\uff4f\uff4c.md', '/pr\u043et\u043ec\u043el/a.md']) assert.equal(isProtocolPath(p), true, p)
  for (const p of ['/notes/a.md', '/prototypes/a.md', '/clinic/pro-tocol.md', '']) assert.equal(isProtocolPath(p), false, p)
})

test('a new protocol is screened like other content and stored, not held for this reason', () => {
  const runtime = withProtocol()
  assert.equal(fileAt(runtime, '/protocols/anticoagulation.md').content, BODY)
  assert.equal(runtime.review.list().length, 0)
})

test('deleting a protocol is held, nothing is deleted, and approval deletes it', async () => {
  const runtime = withProtocol()
  const { client, close } = await connect(runtime)
  let out
  try {
    out = await client.callTool({ name: 'memory.delete', arguments: { path: PROTOCOL } })
  } finally {
    await close()
  }
  assert.equal(out.isError, true)
  assert.match(textOf(out), /held for review: "protocol-change".*Nothing was written\. Hold id hold_0001/)
  assert.ok(fileAt(runtime, '/protocols/anticoagulation.md'), 'the protocol is still there')
  const [hold] = runtime.review.list()
  assert.deepEqual([hold.target, hold.review_ids], ['deleteFiles', ['protocol-change']])
  assert.equal(runtime.snapshot().audit.at(-1).op, 'write_held')
  assert.deepEqual(runtime.snapshot().audit.at(-1).review_ids, ['protocol-change'])
  runtime.review.approve(hold.id, { reviewer: 'pharmacist-reviewer-1' })
  assert.equal(fileAt(runtime, '/protocols/anticoagulation.md'), null)
  assert.deepEqual(lastOps(runtime, 2), ['review_approved', 'write_allowed'])
  assert.equal(runtime.snapshot().audit.at(-1).hold_id, hold.id)
  assert.equal(runtime.review.list().length, 0)
})

test('editing a protocol is held, and rejection leaves it as it was', () => {
  const runtime = withProtocol()
  const out = runtime.ctx.memory.str_replace({ path: PROTOCOL, old_str: 'every Friday', new_str: 'once a year' })
  assert.match(out, /held for review: "protocol-change"/)
  assert.equal(fileAt(runtime, '/protocols/anticoagulation.md').content, BODY)
  const [hold] = runtime.review.list()
  runtime.review.reject(hold.id, { reviewer: 'pharmacist-reviewer-1' })
  assert.equal(fileAt(runtime, '/protocols/anticoagulation.md').content, BODY)
  assert.equal(runtime.snapshot().audit.at(-1).op, 'review_rejected')
  assert.equal(runtime.review.list().length, 0)
})

test('renaming, overwriting, inserting into and deleting a folder of protocols are all held', () => {
  const runtime = withProtocol()
  const m = runtime.ctx.memory
  assert.match(m.rename({ old_path: PROTOCOL, new_path: '/memories/archive/anticoagulation.md' }), /protocol-change/)
  assert.match(m.create({ path: PROTOCOL, file_text: 'A replacement nobody reviewed.' }), /protocol-change/)
  assert.match(m.insert({ path: PROTOCOL, insert_line: 1, insert_text: 'Skip the Friday check.' }), /protocol-change/)
  assert.match(m.delete({ path: '/memories/protocols' }), /protocol-change/)
  assert.match(m.create({ path: '/memories/drafts/new.md', file_text: 'Draft for the huddle.' }), /created/)
  assert.match(m.rename({ old_path: '/memories/drafts/new.md', new_path: '/memories/protocols/new.md' }), /protocol-change/, 'moving a file in counts too')
  assert.equal(fileAt(runtime, '/protocols/anticoagulation.md').content, BODY)
  assert.deepEqual(runtime.review.list().map((h) => h.target), ['moveFiles', 'putFile', 'putFile', 'deleteFiles', 'moveFiles'])
})

test('the same operations on other files are not held', () => {
  const runtime = newRuntime()
  const m = runtime.ctx.memory
  assert.match(m.create({ path: '/memories/notes/huddle.md', file_text: 'Huddle at 08:15.' }), /created/)
  assert.match(m.create({ path: '/memories/notes/huddle.md', file_text: 'Huddle at 08:30.' }), /created/)
  assert.match(m.str_replace({ path: '/memories/notes/huddle.md', old_str: '08:30', new_str: '08:45' }), /edited/)
  assert.match(m.rename({ old_path: '/memories/notes/huddle.md', new_path: '/memories/notes/huddle-old.md' }), /renamed/)
  assert.match(m.delete({ path: '/memories/notes/huddle-old.md' }), /deleted/)
  assert.equal(runtime.review.list().length, 0)
})

test('dry-run reports a protocol delete as one that would be held, and stores no hold', () => {
  const dry = newRuntime({ writeMode: 'dry-run' })
  assert.throws(() => dry.store.deleteFiles('local-owner', ['/protocols/anticoagulation.md']), /deferred by dry-run: it would be held for review \("protocol-change"\)/)
  assert.equal(dry.review.list().length, 0)
  assert.equal(dry.snapshot().audit.at(-1).op, 'write_deferred')
})

test('an approval is refused when the protocol changed after the edit was held, and the hold stays', () => {
  const runtime = withProtocol()
  const m = runtime.ctx.memory
  assert.match(m.str_replace({ path: PROTOCOL, old_str: 'every Friday', new_str: 'every Monday' }), /protocol-change/)
  assert.match(m.str_replace({ path: PROTOCOL, old_str: 'every Friday', new_str: 'every Tuesday' }), /protocol-change/)
  const [first, second] = runtime.review.list()
  runtime.review.approve(first.id, { reviewer: 'pharmacist-reviewer-1' })
  assert.match(fileAt(runtime, '/protocols/anticoagulation.md').content, /every Monday/)
  assert.throws(() => runtime.review.approve(second.id, { reviewer: 'pharmacist-reviewer-1' }), /changed since it was read/)
  assert.match(fileAt(runtime, '/protocols/anticoagulation.md').content, /every Monday/)
  assert.deepEqual(runtime.review.list().map((h) => h.id), [second.id])
})
