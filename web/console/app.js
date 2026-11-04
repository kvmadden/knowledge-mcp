const $ = id => document.getElementById(id)
let state
let busy = false
let playing = false
let generation = 0
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const source = e => `<p class="source">Source: ${escape(e.args.provenance.source)} · Source date: ${escape(e.args.provenance.observedAt)} · ${escape(e.args.provenance.trust)}, caller asserted</p>`
const badge = status => `<span class="status ${escape(status)}">${escape(String(status).toUpperCase())}</span>`
const empty = (title, text) => `<div class="empty"><h3>${title}</h3><p>${text}</p></div>`
const OP_CLASS = { write_allowed: 'op-allowed', review_approved: 'op-allowed', write_held: 'op-held', screen_blocked: 'op-blocked', review_rejected: 'op-blocked' }
function render() {
  $('attempted').textContent = String(state.events.length).padStart(2, '0')
  for (const status of ['allowed', 'blocked', 'held', 'rejected']) $(status).textContent = String(state.events.filter(e => e.status === status).length).padStart(2, '0')
  $('progress').textContent = `${state.events.length} / ${state.total}`
  $('feed').innerHTML = state.events.length ? state.events.map(e => `<article class="event"><div class="event-index">${String(e.id).padStart(2, '0')}</div><div class="event-body"><div class="event-top"><code>${escape(e.tool)}</code>${badge(e.status)}</div><h3>${escape(e.label)}</h3><p class="content">${escape(e.args.text)}</p>${source(e)}<p class="rule"><span>RULE</span>${escape(e.rules.join(', '))}</p></div></article>`).join('') : empty('Memory starts with a decision.', 'Run the synthetic session to watch each write pass through the gate.')
  const pending = state.events.filter(e => e.status === 'held')
  $('queue').innerHTML = pending.length ? pending.map(e => `<article class="queue-item"><div class="event-top"><small>WRITE ${String(e.id).padStart(2, '0')}</small>${badge(e.status)}</div><h3>${escape(e.label)}</h3><p>${escape(e.args.text)}</p>${source(e)}<div class="queue-actions"><button class="primary" data-id="${e.id}" data-action="approve">Approve as reviewer</button><button data-id="${e.id}" data-action="reject">Reject</button></div></article>`).join('') : empty('Nothing awaiting review', state.events.length ? 'Held writes will appear here as the session runs.' : 'You stay in control of what becomes memory.')
  $('audit').innerHTML = state.audit.length ? `<div class="table-wrap"><table><thead><tr><th>ATTEMPT / TIME</th><th>GATE RECEIPT</th><th>SOURCE / OBSERVED</th><th>RULE</th></tr></thead><tbody>${state.audit.map(a => `<tr><td data-label="ATTEMPT"><span><b>#${escape(a.attempt)}</b> <time>${escape(new Date(a.at).toLocaleTimeString('en-GB'))}</time></span></td><td data-label="RECEIPT"><code class="${OP_CLASS[a.op] ?? ''}">${escape(a.op)}</code></td><td data-label="SOURCE"><span>${escape(a.source)}<small>${escape(a.observedAt)}</small></span></td><td data-label="RULE">${escape(a.pattern_ids?.join(', ') || 'No violation')}</td></tr>`).join('')}</tbody></table></div><p class="audit-note">Source and observed date are synthetic caller assertions. Gate receipt timestamps are generated at execution. Approvals and rejections are store audit entries that name the reviewer label, which this demo does not authenticate. "No violation" means no listed pattern was found, not that the content is safe.</p>` : empty('A clear trail, from the first write.', 'Gate receipts appear here with their source and observed date.')
  const attacks = state.attacks
  $('red').innerHTML = `<div class="red-intro"><div><span class="eyebrow">ADVERSARIAL REPLAY</span><h3>Test the boundary.</h3><p>Untrusted documents and injected instructions meet the same write gate.</p></div><button id="attacks">Replay red-team cases</button></div>${attacks.map(e => `<article class="attack"><div>${badge(e.status)}<h3>${escape(e.label)}</h3><p>${escape(e.args.text)}</p></div><code>${escape(e.rules.join(', '))}</code></article>`).join('')}`
  controls()
}
function controls() {
  $('next').disabled = busy || playing || state?.events.length === state?.total
  $('replay').disabled = busy || playing || state?.events.length === state?.total
  $('reset').disabled = busy || playing
  document.querySelectorAll('[data-action], #attacks').forEach(el => { el.disabled = busy || playing })
  $('replay').textContent = playing ? 'Replaying' : 'Run session'
  $('loading').hidden = !busy
}
async function request(path = '/api/session', method = 'GET') {
  busy = true
  controls()
  $('error').hidden = true
  try {
    const response = await fetch(path, { method })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Request failed')
    state = data
    render()
    return true
  } catch {
    $('error').innerHTML = 'The local console could not complete this request. Check the server and try again. <button id="retry">Reconnect</button>'
    $('error').hidden = false
    return false
  } finally {
    busy = false
    controls()
  }
}
async function replay() {
  playing = true
  const token = ++generation
  controls()
  try {
    while (token === generation && state.events.length < state.total) {
      if (!await request('/api/next', 'POST')) break
      await new Promise(resolve => setTimeout(resolve, 700))
    }
  } finally {
    playing = false
    controls()
  }
}
$('replay').onclick = replay
$('next').onclick = () => request('/api/next', 'POST')
$('reset').onclick = () => request('/api/reset', 'POST')
document.addEventListener('click', e => {
  const button = e.target.closest('button')
  if (button?.dataset.action) request(`/api/review/${button.dataset.id}/${button.dataset.action}`, 'POST')
  if (button?.id === 'attacks') request('/api/red-team', 'POST')
  if (button?.id === 'retry') request()
})
function selectTab(red) {
  $('audit').hidden = red
  $('red').hidden = !red
  $('audit-tab').setAttribute('aria-selected', String(!red))
  $('red-tab').setAttribute('aria-selected', String(red))
  $('audit-tab').tabIndex = red ? -1 : 0
  $('red-tab').tabIndex = red ? 0 : -1
}
$('audit-tab').onclick = () => selectTab(false)
$('red-tab').onclick = () => selectTab(true)
document.querySelector('.tabs').onkeydown = e => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    e.preventDefault()
    const red = e.key === 'End' || (e.key !== 'Home' && $('audit-tab').getAttribute('aria-selected') === 'true')
    selectTab(red)
    $(red ? 'red-tab' : 'audit-tab').focus()
  }
}
await request()
