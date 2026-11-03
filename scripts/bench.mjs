// Benchmarks for the two availability limits found in the 2026-11-03 review:
// screening time against input size and shape, and restart time against
// store size. Prints JSON; writes nothing unless a path is given.
//
//   node scripts/bench.mjs [output.json]
//
// Numbers depend on the machine. CI runs a smaller version as a regression
// check (test/store-reliability.test.js), with generous bounds.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import path from 'node:path'

import { buildRuntime } from '../src/server.js'
import { loadGate } from '../src/screening/load-deny-list.js'

const gate = loadGate()
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const time = (fn, runs = 5) => median(Array.from({ length: runs }, () => { const t = performance.now(); fn(); return performance.now() - t }))

const shapes = {
  'english prose': (n) => 'The care team reviewed the refill queue before outreach. '.repeat(Math.ceil(n / 57)).slice(0, n),
  'hex dump': (n) => Array.from({ length: n }, (_, i) => '0123456789abcdef'[(i * 7 + 3) % 16]).join(''),
  'url-safe base64': (n) => Array.from({ length: n }, (_, i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[(i * 29 + 5) % 64]).join(''),
  'one long word': (n) => 'a'.repeat(n),
  'digits with spaces': (n) => '1234 '.repeat(Math.ceil(n / 5)).slice(0, n),
}
const screening = []
for (const [shape, make] of Object.entries(shapes)) {
  for (const n of [10_000, 100_000, 900_000]) {
    const text = make(n)
    let decision
    const ms = time(() => { decision = gate.screen({ text }).decision }, n > 100_000 ? 3 : 5)
    screening.push({ shape, chars: n, ms: Number(ms.toFixed(1)), decision })
  }
}

const restart = []
const dir = mkdtempSync(path.join(tmpdir(), 'knowledge-bench-'))
try {
  for (const records of [1_000, 10_000]) {
    const storePath = path.join(dir, `store-${records}.json`)
    const at = '2026-11-03T12:00:00.000Z'
    writeFileSync(storePath, JSON.stringify({
      version: 2, nextRecord: records + 1, nextHold: 1, audit: [], pending: [], files: [],
      records: Array.from({ length: records }, (_, i) => ({ id: `rec_${i + 1}`, seq: i + 1, owner_id: 'local-owner', text: `Synthetic operations note ${i + 1} about queue staffing and the weekly digest.`, bucket: null, source_app: 'knowledge-mcp', provenance: { source: 'knowledge-mcp', observedAt: null, trust: 'unspecified', recordedAt: at }, status: 'inbox', tags: ['digest'], meta: { type: 'note' }, created_at: at, updated_at: at })),
    }))
    const ms = time(() => buildRuntime({ storePath }), 3)
    const runtime = buildRuntime({ storePath })
    const writeMs = time(() => runtime.ctx.records.create({ text: 'one more synthetic note' }), 5)
    restart.push({ records, restartMs: Number(ms.toFixed(0)), writeMs: Number(writeMs.toFixed(1)) })
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const report = { node: process.version, cpu: cpus()[0]?.model ?? 'unknown', policy: gate.policyId, screening, restart }
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
