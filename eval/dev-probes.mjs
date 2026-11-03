// Runs the 84 development probes in eval/dev/claude-probes.json through a
// real MCP client and server, one fresh runtime per probe.
//
// DEVELOPMENT DATA. The Claude reviewer wrote these probes on 2026-11-03
// after reading the code, to find bypasses, and the rules added that day
// were built with them in view. Use them to catch regressions and to show
// what changed. Do not quote them as a detection rate: that needs the fresh
// blind set described in docs/evaluation/README.md.
//
// EVAL_RUNTIME_ROOT=/path/to/other/checkout runs the same probes against
// another revision (its test/_helpers.js and src/ are imported).
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(process.env.EVAL_RUNTIME_ROOT || '.')
const { newRuntime, connect, textOf, dataOf } = await import(pathToFileURL(path.join(root, 'test/_helpers.js')))
const suite = JSON.parse(readFileSync(new URL('./dev/claude-probes.json', import.meta.url)))

const results = []
for (const probe of suite.cases) {
  const runtime = newRuntime()
  const { client, close } = await connect(runtime)
  let last
  let before
  try {
    for (let i = 0; i < probe.steps.length; i += 1) {
      const [name, args] = probe.steps[i]
      if (i === probe.steps.length - 1) before = runtime.snapshot()
      last = await client.callTool({ name, arguments: args })
    }
  } finally {
    await close()
  }
  const after = runtime.snapshot()
  const stored = dataOf(before) !== dataOf(after)
  const text = textOf(last)
  const outcome = stored ? 'stored' : /held for review/.test(text) ? 'held' : /rejected by screening/.test(text) ? 'blocked' : last.isError ? 'refused' : 'unchanged'
  const pass = probe.expected === 'block' ? !stored : stored
  results.push({ id: probe.id, group: probe.group, expected: probe.expected, outcome, pass })
}
const byGroup = {}
for (const r of results) {
  byGroup[r.group] ??= { pass: 0, total: 0 }
  byGroup[r.group].total += 1
  if (r.pass) byGroup[r.group].pass += 1
}
const report = {
  runtime: process.argv[3] || 'candidate',
  status: 'development data, written and seen by the Claude reviewer on 2026-11-03',
  total: results.length,
  pass: results.filter((r) => r.pass).length,
  risky: { total: results.filter((r) => r.expected === 'block').length, notStored: results.filter((r) => r.expected === 'block' && r.pass).length },
  harmless: { total: results.filter((r) => r.expected === 'allow').length, stored: results.filter((r) => r.expected === 'allow' && r.pass).length },
  outcomes: Object.fromEntries(['stored', 'held', 'blocked', 'refused', 'unchanged'].map((o) => [o, results.filter((r) => r.outcome === o).length])),
  byGroup,
  results,
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, results: undefined }))
