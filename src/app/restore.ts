import type { ArchiveRecord, SessionSnapshot } from '../domain/model.js'
import type { ArchiveStore } from '../ports/archive-store.js'
import type { HostAdapter, SessionSpec } from '../ports/host-adapter.js'
import { resolveRecord } from './records.js'

export interface RestoreDeps {
  readonly adapters: ReadonlyMap<string, HostAdapter>
  readonly store: ArchiveStore
  readonly clock: () => number
}

export class RestoreError extends Error {}

export class RestoreService {
  constructor(private readonly deps: RestoreDeps) {}

  async run(query: string): Promise<ArchiveRecord> {
    const release = await this.deps.store.lock()
    try {
      return await this.restore(query)
    } finally {
      await release()
    }
  }

  private async restore(query: string): Promise<ArchiveRecord> {
    const record = await resolveRecord(this.deps.store, query)
    if (record.status !== 'archived') throw new RestoreError(`Archive ${record.id} is already ${record.status}.`)

    const adapter = this.deps.adapters.get(record.host)
    if (!adapter) throw new RestoreError(`Host "${record.host}" is not enabled in the config.`)

    const availability = await adapter.probe()
    if (!availability.available) throw new RestoreError(`${record.host} is unavailable: ${availability.reason}`)

    await adapter.restore(record.workspace, record.mode === 'closed' ? record.sessions.map(toSpec) : [])

    const restored: ArchiveRecord = { ...record, status: 'restored', restoredAt: this.deps.clock() }
    await this.deps.store.update(restored)
    return restored
  }
}

function toSpec(session: SessionSnapshot): SessionSpec {
  return {
    title: session.title,
    ...(session.cwd !== undefined && { cwd: session.cwd }),
    ...(session.url !== undefined && { url: session.url }),
    ...(session.agent !== undefined && { command: session.agent.resumeCommand }),
  }
}
