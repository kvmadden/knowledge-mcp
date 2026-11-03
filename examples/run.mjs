// Runs every synthetic example in examples/scenarios.json through a real MCP
// client and server and prints what the gate decided, next to what the
// example expects and why. Development examples, not an evaluation set.
import { readFileSync } from 'node:fs'
import { newRuntime, connect, textOf, dataOf } from '../test/_helpers.js'

export async function runExamples() {
  const { examples } = JSON.parse(readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8'))
  const rows = []
  for (const example of examples) {
    const runtime = newRuntime()
    const { client, close } = await connect(runtime)
    try {
      for (const [name, args] of example.setup ?? []) await client.callTool({ name, arguments: args })
      const before = dataOf(runtime.snapshot())
      const out = await client.callTool({ name: example.tool, arguments: example.args })
      const stored = dataOf(runtime.snapshot()) !== before
      const text = textOf(out)
      const decision = stored ? 'allow' : /held for review/.test(text) ? 'review' : /rejected by screening/.test(text) ? 'block' : 'refused'
      const receipt = runtime.snapshot().audit.at(-1) ?? {}
      rows.push({ id: example.id, expected: example.expected, decision, rules: [...(receipt.pattern_ids ?? []), ...(receipt.review_ids ?? [])], match: decision === example.expected, why: example.why })
    } finally {
      await close()
    }
  }
  return rows
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await runExamples()
  for (const row of rows) console.log(`${row.match ? 'as expected' : 'DIFFERENT  '}  ${row.decision.padEnd(6)} ${row.id}${row.rules.length ? `  [${row.rules.join(', ')}]` : ''}\n             ${row.why}`)
  console.log(`\n${rows.filter((r) => r.match).length} of ${rows.length} examples behaved as described.`)
}
