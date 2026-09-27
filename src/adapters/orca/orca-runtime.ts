import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { OrcaError } from './orca-cli.js'
import type { OrcaEnvelope } from './orca-types.js'

interface RuntimeMetadata {
  readonly authToken: string
  readonly transports: readonly { readonly kind: string; readonly endpoint: string }[]
}

/** Reaches internal runtime methods the `orca` CLI does not expose; they may change, so callers tolerate failure. */
export class OrcaRuntime {
  constructor(
    private readonly userDataDir: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    const meta = JSON.parse(await readFile(join(this.userDataDir, 'orca-runtime.json'), 'utf8')) as RuntimeMetadata
    const endpoint = meta.transports.find((t) => t.kind === 'unix')?.endpoint
    if (!endpoint) throw new OrcaError('runtime_unavailable', 'no unix transport in orca-runtime.json')

    const envelope = await this.exchange<T>(endpoint, { id: randomUUID(), authToken: meta.authToken, method, params })
    if (!envelope.ok) throw new OrcaError(envelope.error?.code ?? 'unknown', envelope.error?.message ?? method)
    return envelope.result as T
  }

  private exchange<T>(endpoint: string, request: object): Promise<OrcaEnvelope<T>> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(endpoint)
      let buffer = ''
      let settled = false
      const finish = (settle: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        settle()
      }
      const timer = setTimeout(
        () => finish(() => reject(new OrcaError('runtime_timeout', 'no response'))),
        this.timeoutMs,
      )

      socket.setEncoding('utf8')
      socket.on('error', (error) => finish(() => reject(error)))
      socket.on('close', () =>
        finish(() => reject(new OrcaError('runtime_closed', 'connection closed without a reply'))),
      )
      socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
      socket.on('data', (chunk: string) => {
        buffer += chunk
        for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          let message: OrcaEnvelope<T> & { _keepalive?: boolean }
          try {
            message = JSON.parse(line) as typeof message
          } catch {
            return finish(() => reject(new OrcaError('invalid_runtime_response', line.slice(0, 200))))
          }
          if (!message._keepalive) return finish(() => resolve(message))
        }
      })
    })
  }
}
