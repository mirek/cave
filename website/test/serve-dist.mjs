import { createReadStream, statSync } from 'node:fs'
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
  let url
  try {
    url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  } catch {
    response.writeHead(400).end('invalid request URL')
    return
  }
  if (url.pathname === '/cave') {
    response.writeHead(308, { location: base })
    response.end()
    return
  }
  if (!url.pathname.startsWith(base)) {
    response.writeHead(404).end('not found')
    return
  }

  let relative
  try {
    relative = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html'
  } catch {
    response.writeHead(400).end('invalid request path')
    return
  }
  const path = resolve(join(dist, relative))
  if (!path.startsWith(resolve(dist) + sep)) {
    response.writeHead(404).end('not found')
    return
  }
  const fail = error => {
    if (response.headersSent) response.destroy(error)
    else response.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500).end('asset unavailable')
  }
  try {
    if (!statSync(path).isFile()) {
      response.writeHead(404).end('not found')
      return
    }
    const stream = createReadStream(path)
    stream.once('error', fail)
    response.once('close', () => stream.destroy())
    stream.once('open', () => {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
      })
      stream.pipe(response)
    })
  } catch (error) { fail(error) }
})

server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  process.stdout.write(`production website available at http://127.0.0.1:${address.port}${base}\n`)
})

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
