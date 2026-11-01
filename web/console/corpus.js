const $ = id => document.getElementById(id)
$('theme').onclick = () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }
const element = (tag, text) => {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}
$('search-form').onsubmit = async event => {
  event.preventDefault()
  document.querySelector('.results').setAttribute('aria-busy', 'true')
  $('status').textContent = 'Searching committed passages…'
  $('citations').replaceChildren()
  try {
    const params = new URLSearchParams({ question: $('question').value, collection: $('collection').value })
    const response = await fetch(`/api/corpus?${params}`)
    if (!response.ok) throw new Error('Search failed')
    const result = await response.json()
    $('result-title').textContent = result.citations.length ? 'From the source' : 'No matching passage'
    $('status').textContent = result.citations.length ? 'Exact excerpt from the local snapshot. Check the current source before clinical use.' : result.answer
    for (const citation of result.citations) {
      const card = element('article', '')
      card.className = 'panel citation'
      const link = element('a', 'Read original source ↗')
      link.href = citation.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      card.append(element('h3', citation.title), element('blockquote', citation.text), element('p', citation.license), element('p', `Passage ${citation.passageId}${citation.retrievedAt ? ` · Retrieved ${citation.retrievedAt.slice(0, 10)}` : ''}`), link)
      $('citations').append(card)
    }
  } catch {
    $('result-title').textContent = 'Search unavailable'
    $('status').textContent = 'Check the local server and try again.'
  } finally {
    document.querySelector('.results').setAttribute('aria-busy', 'false')
  }
}
$('search-form').requestSubmit()
