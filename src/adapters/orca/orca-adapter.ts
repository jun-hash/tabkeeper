import { readFile } from 'node:fs/promises'
import type { AgentSession, ArchiveMode, SessionState, WorkspaceSnapshot, WorkspaceState } from '../../domain/model.js'
import { PartialArchiveError, type Availability, type HostAdapter, type SessionSpec } from '../../ports/host-adapter.js'
import { messageOf } from '../../shared/errors.js'
import { OrcaError, type OrcaCli } from './orca-cli.js'
import { handlesOf, toHookSessions, toWorkspaces, worktreeSelector } from './orca-mapping.js'
import type { OrcaRuntime } from './orca-runtime.js'
import type { OrcaHookEntry, OrcaTerminal, OrcaTerminalRead, OrcaWorktree } from './orca-types.js'

const LIST_LIMIT = '10000'
const MAX_READ_LINES = 2000

export class OrcaAdapter implements HostAdapter {
  readonly id = 'orca'

  constructor(
    private readonly cli: OrcaCli,
    private readonly runtime: OrcaRuntime,
    private readonly hookStatusPath: string,
  ) {}

  async probe(): Promise<Availability> {
    try {
      await this.cli.json(['status'])
      return { available: true }
    } catch (error) {
      return { available: false, reason: messageOf(error) }
    }
  }

  async inventory(): Promise<readonly WorkspaceState[]> {
    const [ps, list, hooks] = await Promise.all([
      this.cli.json<{ worktrees: OrcaWorktree[] }>(['worktree', 'ps', '--limit', LIST_LIMIT]),
      this.cli.json<{ terminals: OrcaTerminal[] }>(['terminal', 'list', '--limit', LIST_LIMIT]),
      this.readHooks(),
    ])
    return toWorkspaces(ps.worktrees, list.terminals, hooks)
  }

  async readScrollback(_workspace: WorkspaceState, session: SessionState, lines: number): Promise<string | undefined> {
    const limit = String(Math.min(lines, MAX_READ_LINES))
    const panes = await Promise.all(
      handlesOf(session.ref).map((handle) =>
        this.cli.json<OrcaTerminalRead>(['terminal', 'read', '--terminal', handle, '--limit', limit]),
      ),
    )
    const text = panes.map((p) => p.terminal.tail.join('\n')).join('\n\n')
    return text.trim() ? text : undefined
  }

  async closeSession(_workspace: WorkspaceState, session: SessionState): Promise<void> {
    const [handle] = handlesOf(session.ref)
    if (!handle) return
    await this.cli.json(['terminal', 'close', '--terminal', handle, '--tab'])
  }

  /**
   * Hides the worktree with Orca's archive flag, then puts it to sleep so Orca remembers its agent sessions.
   * Only when the runtime certainly did not run the call does it fall back to closing tabs one by one.
   */
  async archiveWorkspace(workspace: WorkspaceState): Promise<ArchiveMode> {
    try {
      await this.setArchived(workspace.ref, true)
    } catch (error) {
      if (!isRuntimeUnreachable(error)) throw error
      await this.closeAll(workspace)
      return 'closed'
    }
    await this.runtime.call('worktree.sleep', { worktree: workspace.ref }).catch(() => undefined)
    return 'native'
  }

  /** Orca terminals always start in the worktree root, so a spec's cwd is implied; URLs are not supported. */
  async restore(snapshot: WorkspaceSnapshot, sessions: readonly SessionSpec[]): Promise<void> {
    const worktree = await this.findWorktree(snapshot)
    const selector = worktreeSelector(worktree.worktreeId)
    if (worktree.isArchived) await this.setArchived(selector, false)
    for (const spec of sessions) {
      const command = spec.command ? ['--command', spec.command] : []
      await this.cli.json(['terminal', 'create', '--worktree', selector, '--title', spec.title, ...command])
    }
  }

  async removeWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    const worktree = await this.findWorktree(snapshot)
    if (worktree.worktreeId !== snapshot.ref.replace(/^id:/, '') || !worktree.isArchived) {
      throw new Error(`"${snapshot.title}" is in use again; not removing it.`)
    }
    await this.cli.json(['worktree', 'rm', '--worktree', worktreeSelector(worktree.worktreeId)])
  }

  private async closeAll(workspace: WorkspaceState): Promise<void> {
    let closed = 0
    for (const session of workspace.sessions) {
      try {
        await this.closeSession(workspace, session)
        closed++
      } catch (error) {
        if (closed > 0) throw new PartialArchiveError(`closed ${closed} of ${workspace.sessions.length} tabs: ${messageOf(error)}`)
        throw error
      }
    }
  }

  private async findWorktree(snapshot: WorkspaceSnapshot): Promise<OrcaWorktree> {
    const { worktrees } = await this.cli.json<{ worktrees: OrcaWorktree[] }>(['worktree', 'ps', '--limit', LIST_LIMIT])
    const match =
      worktrees.find((w) => worktreeSelector(w.worktreeId) === snapshot.ref) ??
      worktrees.find((w) => snapshot.path !== undefined && w.path === snapshot.path)
    if (!match) throw new Error(`Orca no longer has the worktree "${snapshot.title}" (${snapshot.path ?? snapshot.ref}).`)
    return match
  }

  private async setArchived(selector: string, isArchived: boolean): Promise<void> {
    await this.runtime.call('worktree.set', { worktree: selector, isArchived })
  }

  private async readHooks(): Promise<ReadonlyMap<string, AgentSession>> {
    try {
      const file = JSON.parse(await readFile(this.hookStatusPath, 'utf8')) as { entries?: Record<string, OrcaHookEntry> }
      return toHookSessions(file.entries ?? {})
    } catch {
      return new Map()
    }
  }
}

const UNREACHABLE_CODES = new Set(['method_not_found', 'unauthorized', 'runtime_unavailable', 'ENOENT', 'ECONNREFUSED'])

function isRuntimeUnreachable(error: unknown): boolean {
  const code = error instanceof OrcaError ? error.code : (error as NodeJS.ErrnoException | undefined)?.code
  return code !== undefined && UNREACHABLE_CODES.has(code)
}
