const $ = id => document.getElementById(id)
const element = (tag, text) => {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}
let latestSearch = 0
// Enter searches, as it did when the question was a one-line field. Shift and
// Enter add a line break.
$('question').onkeydown = event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    $('search-form').requestSubmit()
  }
}
$('search-form').onsubmit = async event => {
  const search = ++latestSearch
  event.preventDefault()
  document.querySelector('.results').setAttribute('aria-busy', 'true')
  $('status').textContent = 'Searching committed passages…'
  $('citations').replaceChildren()
  try {
    const params = new URLSearchParams({ question: $('question').value, collection: $('collection').value })
    const response = await fetch(`/api/corpus?${params}`)
    if (!response.ok) throw new Error('Search failed')
    const result = await response.json()
    if (search !== latestSearch) return
    $('result-title').textContent = result.citations.length ? 'From the source' : 'No matching passage'
    $('status').textContent = result.citations.length ? 'Exact excerpt from the local snapshot. Check the current source before clinical use.' : result.answer
    for (const citation of result.citations) {
      const card = element('article', '')
      card.className = 'panel citation'
      const link = element('a', 'Read original source')
      link.setAttribute('aria-label', 'Read original source (opens in a new tab)')
      link.href = citation.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      card.append(element('h3', citation.title), element('blockquote', citation.text), element('p', citation.license), element('p', `Passage ${citation.passageId}${citation.retrievedAt ? ` · Retrieved ${citation.retrievedAt.slice(0, 10)}` : ''}`), link)
      $('citations').append(card)
    }
  } catch {
    if (search !== latestSearch) return
    $('result-title').textContent = 'Search unavailable'
    $('status').textContent = 'Check the local server and try again.'
  } finally {
    if (search === latestSearch) document.querySelector('.results').setAttribute('aria-busy', 'false')
  }
}
$('search-form').requestSubmit()
