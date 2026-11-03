import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSession } from '../web/console/session.js'

test('clinical case keeps identifiers and fax instructions out of shared memory', () => {
  const session = createSession()
  for (let i = 0; i < session.view().total; i++) session.next()
  const { events, records, audit } = session.view()
  assert.match(events[0].args.text, /care.coordination/i)
  assert.match(events[1].args.text, /MRN/)
  assert.ok(events[1].rules.includes('us-phone-number'))
  assert.ok(events[1].rules.includes('record-number-label'))
  assert.match(events[2].args.text, /refill.outreach/i)
  assert.equal(events[2].status, 'held')
  assert.equal(events[2].args.provenance.source, 'synthetic-refill-outreach-v3')
  assert.equal(events[2].args.provenance.observedAt, '2026-10-30')
  const fax = events.find(event => event.args.provenance.source === 'synthetic-fax-page-2')
  assert.ok(fax, 'fax source must be inspectable')
  assert.equal(fax.status, 'blocked')
  assert.ok(fax.rules.includes('untrusted-source'))
  assert.match(fax.args.text, /dosing guideline/i)
  assert.equal(records.length, 1)
  assert.ok(!JSON.stringify(audit).includes('555-010-0199'))
  session.resolve(3, 'approve')
  assert.equal(session.view().records.length, 2)
  assert.equal(session.view().records[1].provenance.source, events[2].args.provenance.source)
  assert.throws(() => session.resolve(3, 'approve'), /pending/)
})

test('a reviewer decision is an audit entry that names the reviewer and the held payload', () => {
  const session = createSession()
  for (let i = 0; i < 4; i++) session.next()
  const held = session.view().events.filter(event => event.status === 'held')
  assert.deepEqual(held.map(event => event.id), [3, 4], 'the gate, not the script, holds both protocol drafts')
  assert.ok(held.every(event => event.rules.includes('clinical-assertion')))
  session.resolve(3, 'approve')
  session.resolve(4, 'reject')
  const audit = session.view().audit
  const approved = audit.find(entry => entry.op === 'review_approved')
  const rejected = audit.find(entry => entry.op === 'review_rejected')
  assert.ok(approved && rejected)
  assert.match(approved.reviewer, /unauthenticated/)
  assert.match(approved.payload_sha256, /^[0-9a-f]{64}$/)
  assert.equal(audit.filter(entry => entry.op === 'write_allowed' && entry.hold_id === approved.hold_id).length, 1)
  assert.equal(session.view().pending.length, 0)
})

test('console copy states the boundary and never calls a pass safe', () => {
  const html = readFileSync(new URL('../web/console/index.html', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../web/console/app.js', import.meta.url), 'utf8')
  assert.match(html, /synthetic.*no PHI/i)
  assert.match(html, /not that a note is safe or true/)
  assert.match(html, /does not authenticate the reviewer/)
  assert.match(app, /Source date/)
  assert.doesNotMatch(app + html, /screening passed|Pharmacist approval/)
})
