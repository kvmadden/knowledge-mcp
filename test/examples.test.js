// The synthetic examples double as integration tests: each must keep the
// decision its description promises, through a real MCP client and server.
import test from 'node:test'
import assert from 'node:assert/strict'

import { runExamples } from '../examples/run.mjs'

test('every synthetic example behaves as its description says', async () => {
  const rows = await runExamples()
  assert.ok(rows.length >= 12)
  for (const row of rows) assert.equal(row.decision, row.expected, `${row.id}: ${row.why}`)
})
