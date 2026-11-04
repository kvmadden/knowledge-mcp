import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { answer } from '../../src/lib/corpus.js'
import { createSession } from './session.js'

// Loopback only, for every method and path: the Host header must name a
// loopback address, so a page that rebinds its own domain to 127.0.0.1 can
// neither read the session nor drive it.
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i

// Every file the pages load, fonts included, is served from this folder, so
// the browser never asks another host for anything.
export const FILES = Object.freeze({
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/theme.js': ['theme.js', 'text/javascript'],
  '/corpus': ['corpus.html', 'text/html'],
  '/corpus.js': ['corpus.js', 'text/javascript'],
  '/corpus.css': ['corpus.css', 'text/css'],
  '/fonts/ibm-plex-mono-400.woff2': ['fonts/ibm-plex-mono-400.woff2', 'font/woff2'],
  '/fonts/ibm-plex-mono-500.woff2': ['fonts/ibm-plex-mono-500.woff2', 'font/woff2'],
  '/fonts/ibm-plex-mono-600.woff2': ['fonts/ibm-plex-mono-600.woff2', 'font/woff2'],
})

export function createConsoleServer() {
  let session = createSession()
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const host = String(req.headers.host || '')
    if (!LOOPBACK_HOST.test(host)) {
      res.writeHead(403)
      return res.end('Local origin required')
    }
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
        // A state change also needs a browser Origin, when one is sent, that
        // matches the loopback host.
        if (req.headers.origin && req.headers.origin !== `http://${host}`) {
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
      const file = Object.hasOwn(FILES, req.url) ? FILES[req.url] : null
      if (req.method !== 'GET' || !file) {
        res.writeHead(404)
        return res.end()
      }
      res.setHeader('Content-Type', file[1].startsWith('font/') ? file[1] : `${file[1]}; charset=utf-8`)
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
