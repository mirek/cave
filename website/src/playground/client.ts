import type { OpenResult, PlaygroundRequest, QueryResult } from './protocol.ts'

type Pending = {
  readonly operation: PlaygroundRequest['operation']
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

  get isClosed(): boolean { return this.closed }

  constructor(onFailure?: (error: Error) => void) {
    const invalidResponse = () => {
      const error = new Error('Playground worker returned an invalid response')
      this.crash(error)
      onFailure?.(error)
    }
    this.worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (this.closed) return
      const response = event.data
      if (response === null || typeof response !== 'object' || Array.isArray(response) ||
        !('id' in response) || typeof response.id !== 'number' || !Number.isSafeInteger(response.id) || response.id < 1 ||
        !('ok' in response) || typeof response.ok !== 'boolean') return invalidResponse()
      const pending = this.pending.get(response.id)
      if (pending === undefined) return
      if (response.ok) {
        if (!('result' in response) || response.result === null || typeof response.result !== 'object' ||
          Array.isArray(response.result)) return invalidResponse()
        const result = response.result as Record<string, unknown>
        const count = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        if (pending.operation === 'query') {
          if (!count(result.matches) || typeof result.output !== 'string') return invalidResponse()
          this.pending.delete(response.id)
          pending.resolve(result as QueryResult)
        } else {
          if (!count(result.claims) || !count(result.edges) || !count(result.currentBeliefs)) return invalidResponse()
          this.pending.delete(response.id)
          pending.resolve(result as OpenResult)
        }
      } else {
        if (!('error' in response) || typeof response.error !== 'string' ||
          ('fatal' in response && response.fatal !== undefined && typeof response.fatal !== 'boolean')) return invalidResponse()
        this.pending.delete(response.id)
        const error = new Error(response.error)
        pending.reject(error)
        if ('fatal' in response && response.fatal === true) {
          this.crash(error)
          onFailure?.(error)
        }
      }
    })
    this.worker.addEventListener('error', event => {
      if (this.closed) return
      const error = new Error(event.message || 'Playground worker failed')
      this.crash(error)
      onFailure?.(error)
    })
    this.worker.addEventListener('messageerror', () => {
      if (this.closed) return
      const error = new Error('Playground worker returned an unreadable message')
      this.crash(error)
      onFailure?.(error)
    })
  }

  private request(request: PlaygroundOperation): Promise<OpenResult | QueryResult> {
    if (this.closed) return Promise.reject(new Error('Playground worker is closed'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { operation: request.operation, resolve, reject })
      try {
        this.worker.postMessage({ ...request, id })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async open(source: string, sourceName: string): Promise<OpenResult> {
    return await this.request({ operation: 'open', source, sourceName }) as OpenResult
  }

  async append(source: string): Promise<OpenResult> {
    return await this.request({ operation: 'append', source }) as OpenResult
  }

  async query(pattern: string, at?: string): Promise<QueryResult> {
    return await this.request({ operation: 'query', pattern, ...(at === undefined ? {} : { at }) }) as QueryResult
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
