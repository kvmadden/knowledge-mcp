import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { answer } from '../../src/lib/corpus.js'
import { createSession } from './session.js'

export function createConsoleServer() {
  let session = createSession()
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      if (req.url.startsWith('/api/corpus?') && req.method === 'GET') {
        const params = new URL(req.url, 'http://localhost').searchParams
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify(answer((params.get('question') || '').slice(0, 2000), params.get('collection') || 'public')))
      }
      if (req.url === '/api/session' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify(session.view()))
      }
      if (req.method === 'POST') {
        // Loopback only: the Host header must name a loopback address, so a
        // page that rebinds its own domain to 127.0.0.1 cannot drive the
        // console, and a browser Origin, when sent, must match that host.
        const host = String(req.headers.host || '')
        const loopback = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(host)
        if (!loopback || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
          res.writeHead(403)
          return res.end('Local origin required')
        }
        if (req.url === '/api/next') session.next()
        else if (req.url === '/api/red-team') session.redTeam()
        else if (req.url === '/api/reset') session = createSession()
        else {
          const match = /^\/api\/review\/(\d+)\/(approve|reject)$/.exec(req.url)
          if (!match) {
            res.writeHead(404)
            return res.end()
          }
          session.resolve(Number(match[1]), match[2])
        }
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify(session.view()))
      }
      const files = { '/corpus': ['corpus.html', 'text/html'], '/corpus.js': ['corpus.js', 'text/javascript'], '/corpus.css': ['corpus.css', 'text/css'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] }
      const file = files[req.url]
      if (req.method !== 'GET' || !file) {
        res.writeHead(404)
        return res.end()
      }
      res.setHeader('Content-Type', `${file[1]}; charset=utf-8`)
      res.end(await readFile(new URL(file[0], import.meta.url)))
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    }
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317)
  createConsoleServer().listen(port, '127.0.0.1', () => console.log(`Write gate console: http://127.0.0.1:${port}`))
}
