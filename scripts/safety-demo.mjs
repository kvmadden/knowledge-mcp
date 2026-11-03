// Real MCP client calls, in memory, with synthetic data and no model or network.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { writeFileSync } from 'node:fs'
import { buildRuntime, buildServer } from '../src/server.js'

import { clinicalScenario, scenarioArgs } from '../web/console/session.js'

const clock = () => '2026-10-31T12:00:00.000Z'
const steps = []
for (const item of [clinicalScenario[0], clinicalScenario[1], clinicalScenario[2], clinicalScenario[4]]) {
  const label = item.label
  const writeMode = 'commit'
  const args = scenarioArgs(item)
  const runtime = buildRuntime({ writeMode, now: clock })
  const server = buildServer(runtime)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'synthetic-demo-agent', version: '1.0.0' })
  await Promise.all([server.connect(b), client.connect(a)])
  try {
    const response = await client.callTool({ name: 'records.create', arguments: args })
    const snapshot = runtime.snapshot()
    const outcome = snapshot.records.length ? 'Allowed' : snapshot.audit.at(-1)?.op === 'write_held' ? 'Held for review' : 'Blocked'
    steps.push({ label, mode: writeMode, tool: 'records.create', request: args, outcome, response, recordsStored: snapshot.records.length, audit: snapshot.audit, stored: snapshot.records[0] ?? null })
    console.log(`${label}: ${outcome}, ${snapshot.records.length} records stored`)
    console.log(JSON.stringify(snapshot.audit.at(-1)))
  } finally { await client.close() }
}
if (process.argv.includes('--record')) writeFileSync(new URL('../docs/media/safety-demo.json', import.meta.url), JSON.stringify({ synthetic: true, recordedAt: clock(), note: 'Four independent runtimes. A held write waits in the store hold queue until a reviewer approves or rejects it.', steps }, null, 2) + '\n')
