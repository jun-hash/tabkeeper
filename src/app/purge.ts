import type { ArchiveRecord } from '../domain/model.js'
import type { ArchiveStore } from '../ports/archive-store.js'
import type { HostAdapter } from '../ports/host-adapter.js'
import type { WorkspaceGuard } from '../ports/workspace-guard.js'
import { messageOf } from '../shared/errors.js'

export interface PurgeDeps {
  readonly adapters: ReadonlyMap<string, HostAdapter>
  readonly store: ArchiveStore
  readonly guard: WorkspaceGuard
  readonly clock: () => number
}

export interface PurgeOptions {
  readonly afterMs: number
  readonly dryRun: boolean
}

export type PurgeOutcome =
  | { readonly record: ArchiveRecord; readonly result: 'purged' | 'would-purge' }
  | { readonly record: ArchiveRecord; readonly result: 'skipped' | 'failed'; readonly reason: string }

export class PurgeService {
  constructor(private readonly deps: PurgeDeps) {}

  async run(options: PurgeOptions): Promise<readonly PurgeOutcome[]> {
    const cutoff = this.deps.clock() - options.afterMs
    const due = (await this.deps.store.list({ status: 'archived' })).filter(
      (r) => r.kind === 'workspace' && r.archivedAt <= cutoff,
    )

    if (due.length === 0) return []

    const release = options.dryRun ? undefined : await this.deps.store.lock()
    try {
      const live = new Map<string, Promise<ReadonlySet<string> | string>>()
      const outcomes: PurgeOutcome[] = []
      for (const record of due) {
        let lookup = live.get(record.host)
        if (!lookup) live.set(record.host, (lookup = this.liveWorkspaces(record.host)))
        outcomes.push(await this.purgeOne(record, await lookup, options.dryRun))
      }
      return outcomes
    } finally {
      await release?.()
    }
  }

  private async liveWorkspaces(host: string): Promise<ReadonlySet<string> | string> {
    const adapter = this.deps.adapters.get(host)
    if (!adapter) return `${host} is not enabled`
    const availability = await adapter.probe()
    if (!availability.available) return `${host} is unavailable: ${availability.reason}`
    try {
      return new Set((await adapter.inventory()).map((w) => w.ref))
    } catch (error) {
      return `${host} inventory failed: ${messageOf(error)}`
    }
  }

  private async purgeOne(
    record: ArchiveRecord,
    live: ReadonlySet<string> | string,
    dryRun: boolean,
  ): Promise<PurgeOutcome> {
    const adapter = this.deps.adapters.get(record.host)
    const path = record.workspace.path
    if (!adapter?.removeWorkspace) {
      return { record, result: 'skipped', reason: `${record.host} cannot remove workspaces` }
    }
    if (typeof live === 'string') return { record, result: 'skipped', reason: live }
    if (live.has(record.workspace.ref)) return { record, result: 'skipped', reason: 'workspace is in use again' }
    if (path === undefined) return { record, result: 'skipped', reason: 'workspace has no path' }

    const risk = await this.deps.guard.riskOf(path)
    if (risk) return { record, result: 'skipped', reason: risk }
    if (dryRun) return { record, result: 'would-purge' }

    try {
      await adapter.removeWorkspace(record.workspace)
      await this.deps.store.update({ ...record, status: 'purged', purgedAt: this.deps.clock() })
      return { record, result: 'purged' }
    } catch (error) {
      return { record, result: 'failed', reason: messageOf(error) }
    }
  }
}
