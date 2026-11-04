// The console is dark first. A theme chosen with the Theme button is kept for
// the next visit. Otherwise the page opens dark. This runs in the head, before
// the stylesheet paints, so a light choice does not flash dark first.
(() => {
  const root = document.documentElement
  let stored = null
  try { stored = localStorage.getItem('console-theme') } catch {}
  root.dataset.theme = stored === 'light' ? 'light' : 'dark'
  addEventListener('DOMContentLoaded', () => {
    document.getElementById('theme')?.addEventListener('click', () => {
      root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light'
      try { localStorage.setItem('console-theme', root.dataset.theme) } catch {}
    })
  })
})()
