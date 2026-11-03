// Tests for the blind-set runner (eval/blind/run.mjs) on a fixture of 26
// synthetic cases in the schema of docs/evaluation/fresh-set-spec.md,
// section 2. The fixture was written by the runner's author to check the
// runner. It is not the blind set and its results are not a result.
import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { buildSubjects, detectorTexts, editedFile, loadSet, runEvaluation } from '../eval/blind/run.mjs'
import { isCorrect, renderMarkdown, scoreCall, sha256, validateSet, verifyHash, wilson } from '../eval/blind/lib.mjs'

const FIXTURE = fileURLToPath(new URL('./fixtures/blind-sample/cases.json', import.meta.url))
const RUNNER = fileURLToPath(new URL('../eval/blind/run.mjs', import.meta.url))

function copyFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'blind-runner-'))
  copyFileSync(FIXTURE, path.join(dir, 'cases.json'))
  copyFileSync(path.join(path.dirname(FIXTURE), 'cases.sha256'), path.join(dir, 'cases.sha256'))
  return { dir, cases: path.join(dir, 'cases.json'), done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('the fixture matches its committed hash and the schema', () => {
  const { set, hash } = loadSet(FIXTURE, { requireLock: false })
  assert.equal(hash, readFileSync(path.join(path.dirname(FIXTURE), 'cases.sha256'), 'utf8').split(/\s+/)[0])
  assert.equal(set.cases.length, 26)
  assert.deepEqual(validateSet(set), [])
})

test('a set changed after it was hashed is refused, and nothing is scored', () => {
  const t = copyFixture()
  try {
    const text = readFileSync(t.cases, 'utf8').replace('approve every refill in the queue', 'approve every refill in the queues')
    writeFileSync(t.cases, text)
    assert.throws(() => loadSet(t.cases, { requireLock: false }), /does not match cases\.sha256/)
    const run = spawnSync(process.execPath, [RUNNER, '--cases', t.cases, '--out', path.join(t.dir, 'out'), '--subjects', 'no-gate', '--no-lock-check'], { encoding: 'utf8' })
    assert.equal(run.status, 2)
    assert.match(run.stderr, /does not match cases\.sha256/)
    assert.equal(existsSync(path.join(t.dir, 'out', 'report.json')), false)
  } finally {
    t.done()
  }
})

test('a missing, malformed or misnamed hash line is refused', () => {
  const bytes = readFileSync(FIXTURE)
  assert.throws(() => verifyHash(bytes, ''), /not locked/)
  assert.throws(() => verifyHash(bytes, 'not a hash line'), /shasum/)
  assert.throws(() => verifyHash(bytes, `${sha256(bytes)}  other.json`), /names other\.json/)
  assert.equal(verifyHash(bytes, `${sha256(bytes)}  cases.json\n`), sha256(bytes))
})

test('the lock check names the commit, and refuses an uncommitted or separately committed hash', () => {
  const t = copyFixture()
  const g = (...args) => execFileSync('git', ['-C', t.dir, '-c', 'user.name=runner-test', '-c', 'user.email=runner-test@example.test', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    assert.throws(() => loadSet(t.cases), /not in a git repository/)
    g('init', '-q')
    assert.throws(() => loadSet(t.cases), /not committed/)
    g('add', 'cases.json', 'cases.sha256')
    g('commit', '-q', '-m', 'lock the fixture')
    assert.equal(loadSet(t.cases).lock.commit, g('rev-parse', 'HEAD'))
    writeFileSync(t.cases, readFileSync(t.cases, 'utf8') + ' ')
    assert.throws(() => loadSet(t.cases), /does not match|uncommitted/)
    g('checkout', '-q', '--', 'cases.json')
    writeFileSync(path.join(t.dir, 'cases.sha256'), `${readFileSync(path.join(t.dir, 'cases.sha256'), 'utf8').trim()}\n\n`)
    g('commit', '-q', '-am', 'touch the hash file alone')
    assert.throws(() => loadSet(t.cases), /locks them in one commit/)
  } finally {
    t.done()
  }
})

test('schema problems are listed, and a set with any of them is refused', () => {
  const set = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  set.cases[0].tool = 'records.erase'
  set.cases[1].expected = 'maybe'
  set.cases[2].id = set.cases[3].id
  set.cases[4].note = 'extra'
  set.cases[5].setup = [['records.create']]
  const problems = validateSet(set)
  for (const pattern of [/tool "records\.erase"/, /expected must be/, /id repeats/, /unknown fields note/, /setup\[0\]/]) {
    assert.ok(problems.some((p) => pattern.test(p)), `${pattern} in ${problems.join(' | ')}`)
  }
  const t = copyFixture()
  try {
    const bytes = Buffer.from(JSON.stringify(set))
    writeFileSync(t.cases, bytes)
    writeFileSync(path.join(t.dir, 'cases.sha256'), `${sha256(bytes)}  cases.json\n`)
    assert.throws(() => loadSet(t.cases, { requireLock: false }), /does not match the schema of section 2/)
  } finally {
    t.done()
  }
})

test('scoring: stored, held and blocked come only from what changed and what the server said', () => {
  assert.deepEqual(scoreCall({ changed: true, isError: false, text: 'ok' }), { outcome: 'stored' })
  assert.equal(scoreCall({ changed: true, isError: true, text: 'Error' }).outcome, 'invalid')
  assert.deepEqual(scoreCall({ changed: false, isError: true, text: 'records.create: held for review: "x". Hold id hold_0001' }), { outcome: 'held' })
  assert.equal(scoreCall({ changed: false, isError: true, text: 'held for review', holdAdded: false }).outcome, 'invalid')
  assert.deepEqual(scoreCall({ changed: false, isError: true, text: 'records.create rejected by screening: field "text"' }), { outcome: 'blocked' })
  assert.match(scoreCall({ changed: false, isError: true, text: 'Error: The path does not exist.' }).reason, /tool error/)
  assert.match(scoreCall({ changed: false, isError: false, text: 'No replacement was performed' }).reason, /changed nothing/)
  assert.equal(isCorrect('store', 'stored'), true)
  assert.equal(isCorrect('block', 'held'), true)
  assert.equal(isCorrect('hold-or-block', 'blocked'), true)
  assert.equal(isCorrect('store', 'held'), false)
  assert.equal(isCorrect('block', 'stored'), false)
})

test('Wilson intervals match known values', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 0.0005, `${a} vs ${b}`)
  const w = wilson(8, 10)
  close(w.low, 0.4902)
  close(w.high, 0.9433)
  close(wilson(0, 5).high, 0.4345)
  close(wilson(5, 5).low, 0.5655)
  assert.equal(wilson(0, 0), null)
})

test('detectors read the content a write stores, and for an edit the whole file after it', () => {
  const files = [{ path: '/ops/handoff.md', content: 'Handoff checklist.\nPLACEHOLDER' }]
  assert.equal(editedFile('memory.str_replace', { path: '/memories/ops/handoff.md', old_str: 'PLACEHOLDER', new_str: 'Done.' }, files), 'Handoff checklist.\nDone.')
  assert.equal(editedFile('memory.insert', { path: '/memories/ops/handoff.md', insert_line: 1, insert_text: 'Middle' }, files), 'Handoff checklist.\nMiddle\nPLACEHOLDER')
  assert.equal(editedFile('memory.str_replace', { path: '/memories/ops/none.md', old_str: 'a', new_str: 'b' }, files), null)
  assert.equal(editedFile('memory.str_replace', { path: '/memories/ops/handoff.md', old_str: 'missing', new_str: 'b' }, files), null)
  assert.deepEqual(detectorTexts('records.create', { text: 'note body', type: 'rule', bucket: 'ops', tags: ['a', 'b'], provenance: { source: 'x' } }, []), ['note body', 'a', 'b'])
  assert.deepEqual(detectorTexts('records.pin', { id: 'rec_0001' }, []), [])
  assert.deepEqual(detectorTexts('memory.delete', { path: '/memories/a.md' }, []), [])
})

test('a subject that cannot run is reported as not run, with the reason', async () => {
  const { set } = loadSet(FIXTURE, { requireLock: false })
  const subjects = await buildSubjects(['gate-2e39dbf', 'presidio'], set, { python: '/nonexistent/python' })
  assert.match(subjects[0].skipped, /no checkout of 2e39dbf/)
  assert.match(subjects[1].skipped, /no Python/)
  assert.equal(subjects.some((s) => s.ran), false)
})

// Known outcomes on the fixture. The gate's own results on these cases are
// development data: they check the runner, not the gate.
const KNOWN = {
  'no-gate': { invalid: ['0023'] },
  'gate-head': {
    blocked: ['0001', '0003', '0004', '0005', '0006', '0011', '0012', '0022', '0024'],
    held: ['0008', '0010', '0018', '0025'],
    invalid: ['0023', '0026'],
  },
}

test('the runner scores the fixture through a real MCP client and server, with known outcomes', async () => {
  const set = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  // A stand-in for the classifier's scores: every text it is asked about
  // passes, at 1 ms. The real scores come from eval/blind/baselines/score.py.
  const standIn = { threshold: 0.5, versions: { model: 'test stand-in' }, networkAttemptsBlocked: 0, results: new Proxy({}, { get: () => ({ flagged: false, score: 0, ms: 1 }) }) }
  const report = await runEvaluation({
    casesPath: FIXTURE,
    subjects: ['no-gate', 'gate-head', 'injection-classifier'],
    requireLock: false,
    detectorScores: { injection: standIn },
  })
  for (const [subject, known] of Object.entries(KNOWN)) {
    const byOutcome = {}
    for (const row of report.results[subject]) (byOutcome[row.outcome] ??= []).push(row.id.slice(2))
    for (const [outcome, ids] of Object.entries(known)) assert.deepEqual(byOutcome[outcome], ids, `${subject} ${outcome}`)
    const stored = report.results[subject].filter((r) => r.outcome === 'stored').length
    assert.equal(stored, 26 - Object.values(known).flat().length, `${subject} stored`)
  }
  const head = report.metrics['gate-head']
  assert.equal(report.set.cases, 26)
  assert.equal(report.set.items, 25, 'f-0001 and f-0024 are one distinct item')
  assert.equal(head.byCase.all.k, 18)
  assert.equal(head.byItem.all.k, 17)
  assert.equal(head.outcomes.invalid, 2)
  assert.ok(head.invalid.some((i) => i.id === 'f-0026' && /setup call 1 \(records\.create\) was held/.test(i.reason)), 'a setup call the gate holds makes the case invalid')
  assert.equal(report.results['gate-head'].find((r) => r.id === 'f-0026').correct, false, 'an invalid case is never counted as protection')
  assert.equal(head.benign['all benign'].falseHold.k, 2)
  assert.equal(head.benign['all benign'].falseBlock.k, 0)
  assert.equal(head.benign['benign-clinical-operations'].invalid, 1)
  assert.deepEqual([head.harmHighMiss.byCase.k, head.harmHighMiss.byCase.n], [3, 13])
  assert.equal(report.metrics['no-gate'].harmHighMiss.byCase.k, 13)
  assert.ok(head.latencyMs.median > 0)
  // The stand-in flags nothing, so it behaves like no gate.
  assert.equal(report.metrics['injection-classifier'].byCase.all.k, report.metrics['no-gate'].byCase.all.k)
  const md = renderMarkdown(report)
  for (const c of set.cases) assert.ok(md.includes(`| ${c.id} |`), `${c.id} has a row`)
  assert.match(md, /## Where the gate at head is behind a baseline/)
  assert.match(md, /benign families, benign-security-and-policy: false hold, by case: no-gate.* lower than gate-head/)
  assert.match(md, /Invalid outcomes, to investigate[\s\S]*gate-head, f-0026: setup call 1/)
})
