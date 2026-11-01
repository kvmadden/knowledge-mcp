import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function harness() {
  const node = () => ({ children: [], attrs: {}, value: '', textContent: '',
    append(...children) { this.children.push(...children) },
    replaceChildren(...children) { this.children = children },
    setAttribute(key, value) { this.attrs[key] = value },
  })
  const nodes = Object.fromEntries(['theme','search-form','question','collection','status','citations','result-title','results'].map(id => [id, node()]))
  const requests = []
  nodes['search-form'].requestSubmit = () => { nodes['search-form'].pending = nodes['search-form'].onsubmit({ preventDefault() {} }) }
  runInNewContext(readFileSync(new URL('../web/console/corpus.js', import.meta.url), 'utf8'), {
    document: { getElementById: id => nodes[id], querySelector: () => nodes.results, createElement: node, documentElement: { dataset: {} } },
    URLSearchParams,
    fetch: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  })
  const settle = (index, title) => requests[index].resolve({ ok: true, json: async () => ({ citations: [{ title, text: title, license: 'MIT', passageId: title, url: 'https://example.com' }] }) })
  return { nodes, requests, settle }
}

test('only the newest corpus search renders when responses arrive out of order', async () => {
  const { nodes, settle } = harness()
  const old = nodes['search-form'].pending
  nodes['search-form'].requestSubmit()
  const latest = nodes['search-form'].pending
  settle(1, 'latest'); await latest
  settle(0, 'stale'); await old
  assert.equal(nodes.citations.children.length, 1)
  assert.equal(nodes.citations.children[0].children[0].textContent, 'latest')
})

test('stale failure cannot clear busy state or replace a newer search', async () => {
  const { nodes, requests, settle } = harness()
  const old = nodes['search-form'].pending
  nodes['search-form'].requestSubmit()
  const latest = nodes['search-form'].pending
  requests[0].reject(new Error('older request failed')); await old
  assert.equal(nodes.results.attrs['aria-busy'], 'true')
  assert.equal(nodes.status.textContent, 'Searching committed passages…')
  settle(1, 'latest'); await latest
  assert.equal(nodes.results.attrs['aria-busy'], 'false')
  assert.equal(nodes.citations.children.length, 1)
})
