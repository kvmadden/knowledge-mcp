// Reuse the original fixture table and assertions without editing the old set.
// Only registration and reporting are instrumented. Runtime imports use the
// requested control or candidate checkout. No gate or input is substituted.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const root = path.resolve(process.env.EVAL_RUNTIME_ROOT || '.')
const original = readFileSync(path.join(root, 'test/write-paths.test.js'), 'utf8')
let source = original
  .replace('import test from "node:test";', 'const test = () => {}')
  .replace(/from "(\.\.?\/[^\"]+)"/g, (_, spec) => `from "${pathToFileURL(path.resolve(root, 'test', spec))}"`)
  .replace('let screenBlocked = 0;', 'let screenBlocked = 0; let rejected = 0; let noOp = 0; let allowed = 0; let benignAllowed = 0;')
  .replace('if (result.isError) failures.push', 'if (!result.isError) benignAllowed += 1; if (result.isError) failures.push')
  .replace('const where = `${tool.name}', 'if (result.isError) rejected += 1; else if (/No replacement was performed/.test(textOf(result))) noOp += 1; else allowed += 1; const where = `${tool.name}')
  .replace('return { failures, cases, screenBlocked };', 'return { failures, cases, screenBlocked, rejected, noOp, allowed, benignAllowed };')
source += '\nexport async function report() { return Promise.all(WRITE_TOOLS.map(async tool => ({tool: tool.name, ...await auditTool(tool, guardedRuntime)}))) }\n'
const { report } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const results = await report()
const sum = key => results.reduce((n, r) => n + r[key], 0)
const result = { runtime: process.argv[3] || 'candidate', cases: sum('cases'), rejected: sum('rejected'), noOp: sum('noOp'), allowed: sum('allowed'), screenBlocked: sum('screenBlocked'), benignAllowed: sum('benignAllowed'), falseBlocks: 10 - sum('benignAllowed'), failures: results.flatMap(r => r.failures), results }
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ ...result, results: undefined }))
