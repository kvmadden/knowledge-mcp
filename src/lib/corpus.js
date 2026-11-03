import { readFileSync } from 'node:fs'

const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
export const collections = Object.freeze([
  { id: 'fictional', title: 'Fictional demo corpus' },
  { id: 'public', title: 'Public health documents' },
])
const stop = new Set('a an and are as at be by can do does for from how i in is it of on or that the their this to was what when which who with would'.split(' '))
const tokens = text => String(text).toLowerCase().match(/[a-z0-9]+/g)?.filter(t => !stop.has(t)) || []
let indexes
function index() {
  if (indexes) return indexes
  const manifest = load('../../corpus/public/manifest.json')
  const publicPassages = manifest.sources.flatMap(source => load(`../../corpus/public/${source.file}`).map(p => ({
    passageId: p.id, section: p.section, text: p.text, file: source.file,
    sourceId: source.id, title: source.title, license: source.license,
    url: source.url, retrievedAt: source.retrievedAt,
  })))
  const seed = load('../../data/seed.json')
  const fictional = seed.records.map((r, i) => ({
    passageId: `fictional-${i + 1}`, text: [r.title, r.text, r.summary, r.context].filter(Boolean).join(' '),
    title: r.title || 'Fictional demo record', license: 'MIT', url: 'https://github.com/kvmadden/knowledge-mcp/blob/main/data/seed.json', file: 'data/seed.json',
  }))
  indexes = Object.fromEntries([['public', publicPassages], ['fictional', fictional]].map(([id, docs]) => [id, docs.map(doc => ({ doc, terms: tokens([doc.title, doc.section, doc.text].filter(value => typeof value === 'string').join(' ')) }))]))
  return indexes
}

// Deterministic BM25 passage retrieval. No model or network is used.
export function searchCorpus(question, collection = 'public', limit = 3) {
  if (!collections.some(c => c.id === collection)) throw new Error('Unknown collection')
  const docs = index()[collection]
  const query = [...new Set(tokens(question))]
  const average = docs.reduce((n, d) => n + d.terms.length, 0) / docs.length
  return docs.map(({ doc, terms }) => {
    const score = query.reduce((sum, term) => {
      const frequency = terms.filter(t => t === term).length
      const count = docs.filter(d => d.terms.includes(term)).length
      const idf = Math.log(1 + (docs.length - count + 0.5) / (count + 0.5))
      return sum + idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * terms.length / average))
    }, 0)
    return { ...doc, score }
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score || a.passageId.localeCompare(b.passageId)).slice(0, limit)
}

// Share of the question's content words that appear in a passage. BM25 ranks
// any overlap, so a question about a drug the collection never mentions can
// still rank a passage that shares one word. Below this share the tool
// abstains and lists the candidates for a person instead of quoting one as
// the answer. The threshold was set while looking at the 18 regression
// questions and a handful of off-topic questions, so it is development
// tuning, not a measured abstention rate.
export const MIN_COVERAGE = 0.5

export function coverageOf(question, passage) {
  const asked = [...new Set(tokens(question))]
  if (!asked.length) return 0
  const present = new Set(tokens([passage.title, passage.section, passage.text].filter(value => typeof value === 'string').join(' ')))
  return asked.filter(term => present.has(term)).length / asked.length
}

export function answer(question, collection = 'public') {
  const ranked = searchCorpus(question, collection, 3)
  if (!ranked.length) return { collection, mode: 'extractive', answer: 'No matching passage in this collection.', citations: [], candidates: [] }
  const coverage = coverageOf(question, ranked[0])
  if (coverage < MIN_COVERAGE) {
    return {
      collection,
      mode: 'abstain',
      answer: 'No passage in this collection covers this question well enough to quote as an answer. Low-overlap candidates are listed for a person to check.',
      coverage: Number(coverage.toFixed(2)),
      citations: [],
      candidates: ranked.map(({ passageId, title, url }) => ({ passageId, title, url })),
    }
  }
  return { collection, mode: 'extractive', answer: ranked[0].text, coverage: Number(coverage.toFixed(2)), citations: [ranked[0]] }
}
