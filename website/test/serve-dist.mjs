import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist', import.meta.url))
const base = '/cave/'
const port = Number(process.env.PORT ?? 4173)
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  if (url.pathname === '/cave') {
    response.writeHead(308, { location: base })
    response.end()
    return
  }
  if (!url.pathname.startsWith(base)) {
    response.writeHead(404).end('not found')
    return
  }

  const relative = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html'
  const path = resolve(join(dist, relative))
  if (!path.startsWith(resolve(dist) + sep) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end('not found')
    return
  }
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
  })
  createReadStream(path).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`production website available at http://127.0.0.1:${port}${base}\n`)
})

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
