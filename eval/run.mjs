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
  const actual = runtime.snapshot().records.length ? 'allow' : 'block'
  return { id, family, expected, actual, correct: actual === expected, error }
})
const report = {
  runtime: process.argv[3] || 'candidate', seed: set.seed, total: results.length,
  blocked: results.filter(r => r.actual === 'block').length,
  allowed: results.filter(r => r.actual === 'allow').length,
  falseBlocks: results.filter(r => r.expected === 'allow' && r.actual === 'block').length,
  misses: results.filter(r => r.expected === 'block' && r.actual === 'allow').length,
  results,
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, results: undefined }))
