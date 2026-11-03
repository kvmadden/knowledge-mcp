// Runs the 60-case set in eval/heldout.json.
//
// Status: DEVELOPMENT DATA since 2026-11-03. The set was readable while the
// first gate rules were written (its phrasings match those rules exactly),
// and the 2026-11-03 rules were built after reading it. Its results show
// regressions and changes, not generalization. The file name is kept so the
// committed SHA-256 still verifies.
//
// Each case is scored as stored, held for review, blocked by screening, or
// invalid (any other error, which makes the run invalid instead of counting
// as protection). "Not committed" means held or blocked.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const root = process.env.EVAL_RUNTIME_ROOT || path.resolve('.')
const { buildRuntime } = await import(pathToFileURL(path.join(root, 'src/server.js')))
const set = JSON.parse(readFileSync(new URL('./heldout.json', import.meta.url)))
const results = set.cases.map(({ id, family, expected, text, provenance }) => {
  const runtime = buildRuntime({ now: () => '2026-10-31T12:00:00.000Z' })
  let error = null
  try { runtime.ctx.records.create({ text, provenance }) } catch (e) { error = e.name }
  const stored = runtime.snapshot().records.length > 0
  const outcome = stored ? 'stored' : error === 'ReviewRequiredError' ? 'held' : error === 'ScreeningError' ? 'blocked' : 'invalid'
  // `actual` keeps the original two-way scoring so old and new reports compare.
  const actual = stored ? 'allow' : 'block'
  return { id, family, text, expected, outcome, actual, correct: actual === expected, error }
})
const distinct = (rows) => new Set(rows.map((r) => r.text)).size
const risky = results.filter((r) => r.expected === 'block')
const benign = results.filter((r) => r.expected === 'allow')
const report = {
  runtime: process.argv[3] || 'candidate', seed: set.seed, status: 'development data since 2026-11-03', total: results.length,
  blocked: results.filter(r => r.actual === 'block').length,
  allowed: results.filter(r => r.actual === 'allow').length,
  falseBlocks: benign.filter(r => r.actual === 'block').length,
  misses: risky.filter(r => r.actual === 'allow').length,
  outcomes: Object.fromEntries(['stored', 'held', 'blocked', 'invalid'].map((o) => [o, results.filter((r) => r.outcome === o).length])),
  distinctStrings: {
    risky: { total: distinct(risky), notCommitted: distinct(risky.filter((r) => r.actual === 'block')) },
    benign: { total: distinct(benign), refused: distinct(benign.filter((r) => r.actual === 'block')) },
  },
  invalidRun: results.some((r) => r.outcome === 'invalid'),
  results: results.map(({ text, ...rest }) => rest),
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, results: undefined }))
if (report.invalidRun) process.exitCode = 1
