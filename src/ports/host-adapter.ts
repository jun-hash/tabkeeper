import type { ArchiveMode, HostId, SessionState, WorkspaceSnapshot, WorkspaceState } from '../domain/model.js'

export type Availability = { readonly available: true } | { readonly available: false; readonly reason: string }

export interface SessionSpec {
  readonly title: string
  readonly cwd?: string
  readonly command?: string
  readonly url?: string
}

export interface HostAdapter {
  readonly id: HostId

  probe(): Promise<Availability>
  inventory(): Promise<readonly WorkspaceState[]>
  readScrollback(workspace: WorkspaceState, session: SessionState, lines: number): Promise<string | undefined>
  closeSession(workspace: WorkspaceState, session: SessionState): Promise<void>
  archiveWorkspace(workspace: WorkspaceState): Promise<ArchiveMode>
  /**
   * Brings the workspace back — un-hiding it, or recreating it when it is gone — and opens `sessions` in it.
   * `sessions` is empty when the host resumes a natively archived workspace on its own.
   */
  restore(snapshot: WorkspaceSnapshot, sessions: readonly SessionSpec[]): Promise<void>
  /** Deletes the workspace's checkout; implement only if the host can (enables opt-in purge). */
  removeWorkspace?(snapshot: WorkspaceSnapshot): Promise<void>
}

/** Thrown by `archiveWorkspace` when some sessions were already closed, so the snapshot must be kept. */
export class PartialArchiveError extends Error {}
