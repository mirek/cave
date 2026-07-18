import type { OpenResult, PlaygroundRequest, PlaygroundResponse, QueryResult } from './protocol.ts'

type Pending = {
  readonly resolve: (result: OpenResult | QueryResult) => void
  readonly reject: (error: Error) => void
}

type PlaygroundOperation = PlaygroundRequest extends infer Request
  ? Request extends { readonly id: number } ? Omit<Request, 'id'> : never
  : never

export class PlaygroundRuntime {
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private closed = false

  constructor() {
    this.worker.addEventListener('message', (event: MessageEvent<PlaygroundResponse>) => {
      const pending = this.pending.get(event.data.id)
      if (pending === undefined) return
      this.pending.delete(event.data.id)
      if (event.data.ok) pending.resolve(event.data.result)
      else pending.reject(new Error(event.data.error))
    })
    this.worker.addEventListener('error', event => {
      this.crash(new Error(event.message || 'Playground worker failed'))
    })
    this.worker.addEventListener('messageerror', () => {
      this.crash(new Error('Playground worker returned an unreadable message'))
    })
  }

  private request(request: PlaygroundOperation): Promise<OpenResult | QueryResult> {
    if (this.closed) return Promise.reject(new Error('Playground worker is closed'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...request, id })
    })
  }

  async open(source: string, sourceName: string): Promise<OpenResult> {
    return await this.request({ operation: 'open', source, sourceName }) as OpenResult
  }

  async append(source: string): Promise<OpenResult> {
    return await this.request({ operation: 'append', source }) as OpenResult
  }

  async query(pattern: string): Promise<QueryResult> {
    return await this.request({ operation: 'query', pattern }) as QueryResult
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.worker.terminate()
    this.fail(new Error('Playground worker closed'))
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private crash(error: Error): void {
    this.closed = true
    this.worker.terminate()
    this.fail(error)
  }
}
