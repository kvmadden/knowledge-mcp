// Operator commands: screening a text, the review queue, retraction and the
// store scan and purge, run as a separate process the way an operator would.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { buildRuntime } from '../src/server.js'
import { SAMPLES } from './_helpers.js'

const ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url))
const cli = (args, env = {}) => spawnSync(process.execPath, [ENTRY, ...args], { env: { PATH: process.env.PATH, KNOWLEDGE_SEED: 'none', ...env }, encoding: 'utf8' })

test('screen prints the decision and rule ids, never the text', () => {
  const out = cli(['screen', '--text', `Callback ${SAMPLES['us-phone-number']} today`])
  assert.equal(out.status, 0, out.stderr)
  const verdict = JSON.parse(out.stdout)
  assert.equal(verdict.decision, 'block')
  assert.deepEqual(verdict.rule_ids, ['us-phone-number'])
  assert.ok(!out.stdout.includes(SAMPLES['us-phone-number']))
  const clean = JSON.parse(cli(['screen', '--text', 'Plan the sprint review.']).stdout)
  assert.deepEqual([clean.decision, clean.finding], ['allow', 'no-listed-pattern-found'])
})

test('review list, show and approve work on a persisted store, and need a reviewer label', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knowledge-cli-'))
  try {
    const storePath = path.join(dir, 'store.json')
    assert.throws(() => buildRuntime({ storePath }).ctx.records.create({ text: 'Protocol: refill requests go to a pharmacist first.', type: 'rule' }), /held for review/)
    const env = { KNOWLEDGE_STORE_PATH: storePath }
    assert.deepEqual(JSON.parse(cli(['review', 'list'], env).stdout).map((h) => h.id), ['hold_0001'])
    assert.match(JSON.parse(cli(['review', 'show', 'hold_0001'], env).stdout).args[0].text, /refill requests/)
    const missing = cli(['review', 'approve', 'hold_0001'], env)
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /reviewer label/)
    const approved = cli(['review', 'approve', 'hold_0001', '--reviewer', 'pharmacist-cli'], env)
    assert.equal(approved.status, 0, approved.stderr)
    assert.equal(JSON.parse(approved.stdout).result_ref, 'rec_0001')
    const retracted = cli(['records', 'retract', 'rec_0001', '--reviewer', 'pharmacist-cli', '--reason', 'superseded'], env)
    assert.equal(JSON.parse(retracted.stdout).status, 'retracted')
    const ops = JSON.parse(readFileSync(storePath, 'utf8')).audit.map((e) => e.op)
    assert.deepEqual(ops, ['write_held', 'review_approved', 'write_allowed', 'record_retracted'])
    assert.match(cli(['review', 'list']).stderr, /needs KNOWLEDGE_STORE_PATH/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store scan names blocking items by location, and purge clears them so the server starts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knowledge-cli-'))
  try {
    const storePath = path.join(dir, 'store.json')
    buildRuntime({ storePath }).ctx.records.create({ text: 'clean note' })
    buildRuntime({ storePath }).ctx.records.create({ text: 'second clean note' })
    const state = JSON.parse(readFileSync(storePath, 'utf8'))
    state.records[1].text = `edited by hand: ${SAMPLES['email-address']}`
    writeFileSync(storePath, JSON.stringify(state))
    const env = { KNOWLEDGE_STORE_PATH: storePath }
    const refused = cli(['--check'], env)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /store scan/)
    const scan = JSON.parse(cli(['store', 'scan'], env).stdout)
    assert.deepEqual(scan.blocking, [{ collection: 'records', index: 1, ref: 'rec_0002', rule_ids: ['email-address'] }])
    assert.ok(!JSON.stringify(scan).includes(SAMPLES['email-address']))
    assert.equal(JSON.parse(cli(['store', 'purge'], env).stdout).applied, false)
    assert.equal(JSON.parse(cli(['store', 'purge', '--apply', '--reviewer', 'operator-cli'], env).stdout).applied, true)
    const check = cli(['--check'], env)
    assert.equal(check.status, 0, check.stderr)
    assert.equal(JSON.parse(check.stdout).records, 1)
    assert.ok(!readFileSync(storePath, 'utf8').includes(SAMPLES['email-address']))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--check reports holds, the policy id and the real seeding outcome', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knowledge-cli-'))
  try {
    const storePath = path.join(dir, 'store.json')
    buildRuntime({ storePath }).ctx.records.create({ text: 'pre-existing' })
    const cfg = JSON.parse(cli(['--check'], { KNOWLEDGE_STORE_PATH: storePath, KNOWLEDGE_SEED: '' }).stdout)
    assert.equal(cfg.seeded, false, 'a store that already has data is not seeded')
    assert.equal(cfg.records, 1)
    assert.equal(cfg.heldForReview, 0)
    assert.match(cfg.policy.id, /^2-/)
    assert.equal(cfg.tools.length, 18)
    assert.equal(cfg.tools.filter((t) => t.access === 'read').length, 8)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
