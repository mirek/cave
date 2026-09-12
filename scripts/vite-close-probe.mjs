// Disposable development-server compatibility probe. An optional argument selects a Vite entrypoint.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
const root = fileURLToPath(new URL('../website', import.meta.url))
const require = createRequire(`${root}/package.json`)
const {createServer} = await import(process.argv[2] ?? require.resolve('vite'))
const lateWatchFile = fileURLToPath(new URL('../packages/query/src/index.ts', import.meta.url))
const plugins = process.env.CAVE_VITE_LATE_WATCH === '1' ? [{
  name: 'shutdown-watch-regression',
  buildEnd() { this.addWatchFile(lateWatchFile) },
}] : []
const server = await createServer({root, plugins, cacheDir:process.env.CAVE_VITE_CACHE_DIR, server:{host:'127.0.0.1', port:0, strictPort:true}, logLevel:'error'})
let report
try {
  await server.listen()
  const address = server.httpServer.address()
  const checked=[]
  for (const path of ['/', '/src/main.tsx', '/src/pages/Docs.tsx', '/src/pages/Playground.tsx', '/src/playground/worker.ts?worker_file&type=module']) {
    const response=await fetch(`http://127.0.0.1:${address.port}${path}`, {signal:AbortSignal.timeout(20000)})
    const body=await response.text()
    assert.equal(response.status,200,`${path}: ${body.slice(0,500)}`)
    assert.ok(body.length>0,path)
    if (path === '/') assert.match(body, /\/src\/main\.tsx/)
    else assert.match(response.headers.get('content-type'), /javascript/)
    checked.push({path,status:response.status,bytes:Buffer.byteLength(body)})
  }
  report = {node:process.version,checked}
} finally {
  const keepAlive = setInterval(() => {}, 100)
  const diagnostic = setTimeout(() => {
    const client = server.environments.client
    console.error('Pending Vite close:', inspect({
      requests: [...client._pendingRequests.keys()],
      discovered: Object.fromEntries(Object.entries(client.depsOptimizer?.metadata.discovered ?? {}).map(([id, info]) => [id, info.processing])),
    }, { depth: 3 }))
  }, 10000)
  const deadline = setTimeout(() => { throw new Error('development server close exceeded 20 seconds') }, 20000)
  try { await server.close() } finally { clearInterval(keepAlive); clearTimeout(diagnostic); clearTimeout(deadline) }
}
assert.equal(server.watcher.closed, true, 'shutdown must not reopen the file watcher')
console.log(JSON.stringify({...report, closed:true}))
setTimeout(() => console.error('Resources after close:', inspect({
  resources: process.getActiveResourcesInfo(),
  handles: process._getActiveHandles().map(handle => ({type:handle.constructor.name, pid:handle.pid, fd:handle.fd})),
  uv: process.report.getReport().libuv.filter(handle => handle.is_referenced),
}, {depth:4})), 5000).unref()
