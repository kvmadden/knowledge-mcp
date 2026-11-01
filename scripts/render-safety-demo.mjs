// Render actual MCP transcript data. Theme snapshot is imported from registry tokens.
import { readFileSync, writeFileSync } from 'node:fs'
const data = readFileSync(new URL('../docs/media/safety-demo.json', import.meta.url), 'utf8')
const { tokens } = JSON.parse(readFileSync(new URL('../docs/media/theme.json', import.meta.url)))
const variables = Object.entries(tokens).filter(([, value]) => typeof value === 'string').map(([key, value]) => `--${key}:${value}`).join(';')
const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Knowledge MCP | A write under review</title>
<style>
:root{${variables}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--fontSans);line-height:1.5}main{max-width:1200px;margin:auto;padding:40px 28px}header{border-bottom:1px solid var(--border);padding-bottom:24px;margin-bottom:24px}.eyebrow{color:var(--accent);font:600 12px var(--fontMono);text-transform:uppercase;letter-spacing:.12em}h1{font-size:clamp(30px,4vw,48px);line-height:1.12;letter-spacing:-.035em;margin:12px 0}p{max-width:790px;margin:12px 0;color:var(--textMuted)}.bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}button{font:600 15px var(--fontSans);background:var(--accent);color:var(--onAccent);border:0;border-radius:8px;min-height:48px;min-width:150px;padding:12px 20px;cursor:pointer}button:hover{filter:brightness(.94)}button:focus-visible{outline:3px solid var(--text);outline-offset:4px}.step{font:13px var(--fontMono);color:var(--textMuted)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 0}.panel{min-width:0;border:1px solid var(--border);border-radius:12px;background:var(--card);padding:24px}h2{font-size:14px;margin:0 0 16px;text-transform:uppercase;letter-spacing:.08em;color:var(--textMuted)}h3{font-size:24px;margin:0 0 16px}pre{font:14px/1.6 var(--fontMono);white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.decision{display:inline-block;font:600 14px var(--fontMono);padding:6px 12px;border:1px solid var(--accent);border-radius:6px;color:var(--accent);margin:0 0 16px}.metric{font-size:18px;font-weight:600;margin-top:20px}.audit{background:var(--surface);border-top:1px solid var(--border);padding-top:16px;margin-top:20px}.note{font-size:13px;color:var(--textMuted)}footer{border-top:1px solid var(--border);padding-top:16px}.provenance{font-size:13px;overflow-wrap:anywhere;margin-top:12px}strong{color:var(--text)}@media(max-width:650px){main{padding:24px 18px}.grid{grid-template-columns:1fr}.panel{padding:20px}h1{font-size:34px}pre{font-size:13px}header{padding-bottom:16px;margin-bottom:16px}}
</style>
<main><header><div class="eyebrow">Knowledge MCP / synthetic safety demo</div><h1>A care-team write,<br>reviewed before reuse.</h1><p>A care coordinator checks an assistant’s proposed shared memory before outreach. A pharmacist reviews protocol drafts. Synthetic administrative prototype, no clinical decisions.</p></header>
<div class="bar"><div><div class="step" id="step"></div><h3 id="label"></h3></div><button id="next" type="button">Next attempt →</button></div>
<div class="grid"><section class="panel"><h2>1 / Agent attempts a write</h2><div class="step" id="tool"></div><pre id="request"></pre><p class="note">Fictional inputs only. No patient or employer data.</p></section><section class="panel" aria-live="polite"><h2>2 / Gate decision</h2><div class="decision" id="outcome"></div><pre id="reason"></pre><div class="metric" id="count"></div><div class="provenance" id="provenance"></div><div class="audit"><h2>3 / Persisted audit entry</h2><pre id="audit"></pre></div></section></div>
<footer><p class="note"><strong>Recorded replay of real MCP client calls.</strong> Four independent local runtimes, not a sequential patient record. Dry-run holds the protocol for pharmacist review. Use the live console to approve or reject. No authenticated reviewer, clinical truth check, OCR or durable approval service. No model or vendor transfer. Records and audit receipts are in memory only.</p></footer></main>
<script type="application/json" id="transcript">${data.replaceAll('<', '\\u003c')}</script>
<script>
const data = JSON.parse(document.getElementById('transcript').textContent)
let index = 0
const set = (id, text) => { document.getElementById(id).textContent = text }
function render() {
 const s = data.steps[index]
 set('step', 'ATTEMPT ' + (index + 1) + ' OF ' + data.steps.length)
 set('label', s.label)
 set('tool', s.tool + ' / ' + s.mode)
 set('request', JSON.stringify(s.request, null, 2))
 set('outcome', s.outcome)
 const audit = s.audit.at(-1)
 set('reason', audit.op === 'screen_blocked' ? 'Matched: ' + audit.pattern_ids.join(', ') + '\\nThe request did not reach the data store.' : audit.op === 'write_deferred' ? 'Screening passed. Dry-run stopped the write for human review.' : 'Screening passed. The record was stored.')
 set('count', s.recordsStored + (s.recordsStored === 1 ? ' record stored' : ' records stored'))
 set('provenance', 'Source: ' + s.request.provenance.source + ' • Source date: ' + s.request.provenance.observedAt + ' • ' + s.request.provenance.trust + ', caller asserted, not verified')
 set('audit', JSON.stringify(audit, null, 2))
}
document.getElementById('next').addEventListener('click', () => { index = (index + 1) % data.steps.length; render() })
render()
</script></html>`
writeFileSync(new URL('../docs/media/safety-demo.html', import.meta.url), html)
