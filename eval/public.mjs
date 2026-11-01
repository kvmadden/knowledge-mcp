import { readFileSync } from 'node:fs'
import { answer, searchCorpus } from '../src/lib/corpus.js'
const suite = JSON.parse(readFileSync(new URL('./public.json', import.meta.url)))
const sources = JSON.parse(readFileSync(new URL('../corpus/public/manifest.json', import.meta.url))).sources
const committed = new Map(sources.flatMap(s => JSON.parse(readFileSync(new URL(`../corpus/public/${s.file}`, import.meta.url))).map(p => [p.id, { ...p, source: s }])))
const results = suite.cases.map(item => {
  for (const expected of item.expected) {
    if (committed.get(expected.passageId)?.text !== expected.text) throw new Error(`Stale expected passage: ${item.id}`)
  }
  const retrieved = searchCorpus(item.question, 'public', 3)
  const result = answer(item.question, 'public')
  const relevant = citation => item.expected.some(p => p.passageId === citation.passageId && p.text === citation.text)
  const resolves = citation => {
    const passage = committed.get(citation.passageId)
    return passage?.text === citation.text && passage.source.url === citation.url && passage.source.license === citation.license && passage.source.title === citation.title
  }
  return { id: item.id, hit: retrieved.some(relevant), citations: result.citations.length,
    correctCitations: result.citations.filter(relevant).length, resolvedCitations: result.citations.filter(resolves).length,
    retrieved: retrieved.map(p => p.passageId), cited: result.citations.map(p => p.passageId) }
})
const sum = field => results.reduce((n, r) => n + r[field], 0)
console.log(JSON.stringify({ collection: 'public', total: results.length, retrievalK: 3,
  retrievalHitRate: results.filter(r => r.hit).length / results.length,
  citationAccuracy: sum('correctCitations') / sum('citations'),
  resolutionAccuracy: sum('resolvedCitations') / sum('citations'), results }, null, 2))
