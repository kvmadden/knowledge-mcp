import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

test('public manifest contains only allowed sources and matching committed sha256', () => {
  assert.ok(existsSync('corpus/public/manifest.json'), 'public corpus manifest must be committed')
  const manifest = JSON.parse(readFileSync('corpus/public/manifest.json'))
  assert.deepEqual(new Set(manifest.sources.map(s => s.family)), new Set(['cms-ncd', 'openfda-label', 'cdc-acip']))
  for (const source of manifest.sources) {
    const url = new URL(source.url)
    assert.equal(url.protocol, 'https:')
    assert.ok(source.family === 'cms-ncd' ? url.hostname === 'www.cms.gov' && url.pathname === '/medicare-coverage-database/view/ncd.aspx' : source.family === 'openfda-label' ? url.hostname === 'api.fda.gov' && url.pathname === '/drug/label.json' : url.hostname === 'www.cdc.gov' && url.pathname.startsWith('/vaccines/hcp/imz-best-practices/'))
    assert.match(source.retrievedAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.ok(source.license && source.licenseUrl)
    assert.equal(createHash('sha256').update(readFileSync(`corpus/public/${source.file}`)).digest('hex'), source.sha256)
    const passages = JSON.parse(readFileSync(`corpus/public/${source.file}`))
    assert.ok(passages.length > 0)
    assert.equal(new Set(passages.map(p => p.id)).size, passages.length)
  }
})

test('each public answer citation resolves to an exact committed passage', async () => {
  const { answer, collections } = await import('../src/lib/corpus.js')
  assert.deepEqual(collections.map(c => c.id), ['fictional', 'public'])
  const cases = JSON.parse(readFileSync('eval/public.json')).cases
  assert.ok(cases.length >= 15 && cases.length <= 25)
  for (const item of cases) {
    const result = answer(item.question, 'public')
    assert.ok(result.citations.length > 0, item.id)
    for (const citation of result.citations) {
      const passages = JSON.parse(readFileSync(`corpus/public/${citation.file}`))
      assert.equal(passages.find(p => p.id === citation.passageId)?.text, citation.text)
      assert.ok(citation.title && citation.license && citation.url)
    }
  }
  assert.equal(answer('zzzzzzzz', 'public').citations.length, 0)
  assert.throws(() => answer('vaccine', 'unknown'), /Unknown collection/)
})

test('public eval runs offline on committed files with separate retrieval and citation metrics', () => {
  const denyNetwork = `import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { syncBuiltinESMExports } from 'node:module'
const deny = () => { throw new Error('Network forbidden during offline eval') }
globalThis.fetch = deny
http.request = http.get = https.request = https.get = net.connect = net.createConnection = deny
net.Socket.prototype.connect = deny
syncBuiltinESMExports()`
  const report = JSON.parse(execFileSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(denyNetwork)}`, 'eval/public.mjs'], { encoding: 'utf8', env: { PATH: process.env.PATH } }))
  assert.equal(report.collection, 'public')
  assert.ok(report.total >= 15 && report.total <= 25)
  assert.equal(report.retrievalHitRate, 1)
  assert.equal(report.citationAccuracy, 1)
  assert.equal(report.resolutionAccuracy, 1)
  assert.ok(report.controls.wrongKeyCitationHits <= 1, 'wrong-key control must stay near zero')
})

test('public retrieval is available over MCP and HTTP without mutating the store', async () => {
  const { newRuntime, connect, textOf } = await import('./_helpers.js')
  const runtime = newRuntime()
  const before = runtime.snapshot()
  const { client, close } = await connect(runtime)
  try {
    const response = await client.callTool({ name: 'corpus.answer', arguments: { question: 'blood gas oximetry conflicting', collection: 'public' } })
    const result = JSON.parse(textOf(response))
    assert.equal(result.citations[0].passageId, 'cms-oxygen-005')
    assert.deepEqual(runtime.snapshot(), before)
  } finally { await close() }
  const { createConsoleServer } = await import('../web/console/server.js')
  const server = createConsoleServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(`${url}/corpus`)).status, 200)
    const response = await fetch(`${url}/api/corpus?question=onboarding&collection=fictional`)
    const result = await response.json()
    assert.ok(result.citations.every(c => c.passageId.startsWith('fictional-')))
    assert.equal((await fetch(`${url}/api/corpus?question=oxygen&collection=missing`)).status, 400)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('absent section metadata does not add undefined to fictional search terms', async () => {
  const { searchCorpus } = await import('../src/lib/corpus.js')
  assert.equal(searchCorpus('undefined', 'fictional', 99).length, 0)
  assert.ok(searchCorpus('onboarding', 'fictional').length > 0)
})
