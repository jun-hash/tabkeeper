import type { ArchiveMode, ArchiveRecord, SessionState, WorkspaceSnapshot, WorkspaceState } from '../../src/domain/model.js'
import type { CommandResult, CommandRunner } from '../../src/ports/command-runner.js'
import type { ArchiveStore, RecordFilter, Release } from '../../src/ports/archive-store.js'
import type { Availability, HostAdapter, SessionSpec } from '../../src/ports/host-adapter.js'

export class MemoryStore implements ArchiveStore {
  readonly records = new Map<string, ArchiveRecord>()
  readonly scrollbacks = new Map<string, string>()
  locks = 0

  async save(record: ArchiveRecord, scrollback: ReadonlyMap<string, string>): Promise<void> {
    for (const [ref, text] of scrollback) this.scrollbacks.set(`${record.id}/${ref}`, text)
    this.records.set(record.id, record)
  }
  async update(record: ArchiveRecord): Promise<void> {
    this.records.set(record.id, record)
  }
  async remove(id: string): Promise<void> {
    this.records.delete(id)
  }
  async get(id: string): Promise<ArchiveRecord | undefined> {
    return this.records.get(id)
  }
  async list(filter: RecordFilter = {}): Promise<readonly ArchiveRecord[]> {
    return [...this.records.values()].filter(
      (r) => (!filter.host || r.host === filter.host) && (!filter.status || r.status === filter.status),
    )
  }
  async scrollback(id: string, sessionRef: string): Promise<string | undefined> {
    return this.scrollbacks.get(`${id}/${sessionRef}`)
  }
  async lock(): Promise<Release> {
    this.locks++
    return async () => {
      this.locks--
    }
  }
}

export class FakeAdapter implements HostAdapter {
  readonly calls: string[] = []
  readonly restored: { snapshot: WorkspaceSnapshot; sessions: readonly SessionSpec[] }[] = []
  availability: Availability = { available: true }
  archiveMode: ArchiveMode = 'closed'
  failClose = false

  constructor(
    readonly id: string,
    public workspaces: WorkspaceState[] = [],
  ) {}

  async probe(): Promise<Availability> {
    return this.availability
  }
  async inventory(): Promise<readonly WorkspaceState[]> {
    return this.workspaces
  }
  async readScrollback(_w: WorkspaceState, session: SessionState): Promise<string | undefined> {
    return `scrollback of ${session.ref}`
  }
  async closeSession(_w: WorkspaceState, session: SessionState): Promise<void> {
    if (this.failClose) throw new Error('close failed')
    this.calls.push(`close-session ${session.ref}`)
  }
  async archiveWorkspace(workspace: WorkspaceState): Promise<ArchiveMode> {
    this.calls.push(`archive-workspace ${workspace.ref}`)
    return this.archiveMode
  }
  async restore(snapshot: WorkspaceSnapshot, sessions: readonly SessionSpec[]): Promise<void> {
    this.restored.push({ snapshot, sessions })
  }
  async removeWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    this.calls.push(`remove-workspace ${snapshot.ref}`)
  }
}

type Responder = (args: readonly string[]) => Partial<CommandResult> | string

/** Records every command and answers from the first matching responder (matched against the joined argv). */
export function scriptedRunner(responders: Readonly<Record<string, Responder>>) {
  const calls: string[][] = []
  const runner: CommandRunner = async (command, args) => {
    calls.push([command, ...args])
    const line = args.join(' ')
    const entry = Object.entries(responders).find(([pattern]) => line.includes(pattern))
    const answer = entry ? entry[1](args) : ''
    const result = typeof answer === 'string' ? { stdout: answer } : answer
    return { stdout: '', stderr: '', exitCode: 0, ...result }
  }
  return { runner, calls }
}
