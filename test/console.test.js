import test from 'node:test'
import assert from 'node:assert/strict'
import { createSession } from '../web/console/session.js'

test('script runs real screening and approval commits only once', () => {
  const s = createSession()
  assert.equal(s.view().events.length, 0)
  for (let i = 0; i < 6; i++) s.next()
  const v = s.view()
  assert.deepEqual(v.events.map(e => e.status), ['allowed', 'blocked', 'held', 'held', 'blocked', 'blocked'])
  assert.equal(v.records.length, 1)
  assert.ok(v.events[4].rules.includes('untrusted-source'))
  assert.ok(v.events[5].rules.length)
  s.resolve(3, 'approve')
  assert.equal(s.view().records.length, 2)
  assert.throws(() => s.resolve(3, 'approve'), /pending/)
  s.resolve(4, 'reject')
  assert.equal(s.view().records.length, 2)
  assert.equal(s.view().events[3].status, 'rejected')
  assert.equal(s.view().records[1].provenance.source, 'synthetic-refill-outreach-v3')
  assert.ok(s.view().audit.some(e => e.op === 'write_deferred'))
  assert.ok(s.view().audit.some(e => e.op === 'screen_blocked'))
})

test('HTTP console isolates local actions and reports stale approval errors', async () => {
  const { createConsoleServer } = await import('../web/console/server.js')
  const server = createConsoleServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(url)).status, 200)
    assert.equal((await fetch(`${url}/api/next`, { method: 'POST', headers: { origin: 'https://example.test' } })).status, 403)
    for (let i = 0; i < 3; i++) assert.equal((await fetch(`${url}/api/next`, { method: 'POST' })).status, 200)
    assert.equal((await fetch(`${url}/api/review/3/approve`, { method: 'POST' })).status, 200)
    assert.equal((await fetch(`${url}/api/review/3/approve`, { method: 'POST' })).status, 400)
    const reset = await fetch(`${url}/api/reset`, { method: 'POST' })
    assert.equal((await reset.json()).events.length, 0)
    assert.equal((await fetch(`${url}/../session.js`)).status, 404)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('red-team cases can be replayed after the scripted session completes', () => {
  const s = createSession()
  for (let i = 0; i < 6; i++) s.next()
  assert.equal(typeof s.redTeam, 'function', 'red-team replay must run independently of the completed script')
  s.redTeam()
  const first = s.view().audit.length
  s.redTeam()
  assert.equal(s.view().audit.length, first + 2)
  assert.deepEqual(s.view().attacks.map(e => e.status), ['blocked', 'blocked'])
  assert.equal(s.view().records.length, 1)
})
