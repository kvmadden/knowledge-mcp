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

test('console gives a reviewer an accountable action and visible product boundaries', () => {
  const html = readFileSync(new URL('../web/console/index.html', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../web/console/app.js', import.meta.url), 'utf8')
  assert.match(html, /care coordinator/i)
  assert.match(html, /pharmacist/i)
  assert.match(html, /synthetic.*no PHI/i)
  assert.match(html, /prototype/i)
  assert.match(html, /clinical facts/i)
  assert.match(app, /Source date/)
  assert.match(app, /Pharmacist approval/)
})
