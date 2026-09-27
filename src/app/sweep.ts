import type { ArchiveRecord, HostId, WorkspaceState } from '../domain/model.js'
import { plan, type Action, type Kept, type Policy } from '../domain/policy.js'
import type { ArchiveStore } from '../ports/archive-store.js'
import { PartialArchiveError, type HostAdapter } from '../ports/host-adapter.js'
import { formatDuration } from '../shared/duration.js'
import { messageOf } from '../shared/errors.js'
import type { IdFactory } from './ids.js'
import type { ObservedActivity } from './observed-activity.js'
import { toWorkspaceSnapshot, type SessionCapturer } from './snapshot.js'

export interface SweepDeps {
  readonly adapters: readonly HostAdapter[]
  readonly store: ArchiveStore
  readonly capturer: SessionCapturer
  readonly activity: ObservedActivity
  readonly policy: Policy
  readonly clock: () => number
  readonly newId: IdFactory
}

export interface SweepOptions {
  readonly dryRun: boolean
}

export interface ActionFailure {
  readonly action: Action
  readonly message: string
}

export type HostReport =
  | { readonly host: HostId; readonly status: 'unavailable' | 'failed'; readonly reason: string }
  | {
      readonly host: HostId
      readonly status: 'ok'
      readonly planned: readonly Action[]
      readonly kept: readonly Kept[]
      readonly archived: readonly ArchiveRecord[]
      readonly failures: readonly ActionFailure[]
    }

export class SweepService {
  constructor(private readonly deps: SweepDeps) {}

  async run(options: SweepOptions): Promise<readonly HostReport[]> {
    const release = options.dryRun ? undefined : await this.deps.store.lock()
    try {
      const reports: HostReport[] = []
      for (const adapter of this.deps.adapters) reports.push(await this.sweepHost(adapter, options))
      return reports
    } finally {
      await release?.()
    }
  }

  private async sweepHost(adapter: HostAdapter, options: SweepOptions): Promise<HostReport> {
    const availability = await adapter.probe()
    if (!availability.available) return { host: adapter.id, status: 'unavailable', reason: availability.reason }

    let workspaces: readonly WorkspaceState[]
    try {
      workspaces = await this.deps.activity.apply(adapter.id, await adapter.inventory(), { persist: !options.dryRun })
    } catch (error) {
      return { host: adapter.id, status: 'failed', reason: messageOf(error) }
    }

    const { actions, kept } = plan(workspaces, this.deps.policy, this.deps.clock())
    const archived: ArchiveRecord[] = []
    const failures: ActionFailure[] = []

    if (!options.dryRun) {
      for (const action of actions) {
        try {
          archived.push(await this.execute(adapter, action))
        } catch (error) {
          failures.push({ action, message: messageOf(error) })
        }
      }
    }

    return { host: adapter.id, status: 'ok', planned: actions, kept, archived, failures }
  }

  private async execute(adapter: HostAdapter, action: Action): Promise<ArchiveRecord> {
    const { workspace } = action
    const targets = action.kind === 'archive-workspace' ? workspace.sessions : [action.session]
    const captured = await this.deps.capturer.capture(adapter, workspace, targets)
    const archivedAt = this.deps.clock()

    const record: ArchiveRecord = {
      id: this.deps.newId(archivedAt),
      host: adapter.id,
      kind: action.kind === 'archive-workspace' ? 'workspace' : 'session',
      mode: 'closed',
      archivedAt,
      reason: `idle for ${formatDuration(action.idleMs)}`,
      workspace: toWorkspaceSnapshot(workspace),
      sessions: captured.sessions,
      status: 'archived',
    }

    await this.deps.store.save(record, captured.scrollback)
    try {
      if (action.kind === 'archive-session') {
        await adapter.closeSession(workspace, action.session)
        return record
      }
      const mode = await adapter.archiveWorkspace(workspace)
      if (mode === record.mode) return record
      const updated = { ...record, mode }
      await this.deps.store.update(updated)
      return updated
    } catch (error) {
      // A record exists only for work that was actually closed; a partial close keeps it so nothing is lost.
      if (!(error instanceof PartialArchiveError)) await this.deps.store.remove(record.id)
      throw error
    }
  }
}
