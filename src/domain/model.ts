export type HostId = string

export interface AgentSession {
  readonly tool: string
  readonly sessionId: string
  readonly resumeCommand: string
}

export interface SessionState {
  readonly ref: string
  readonly title: string
  readonly cwd?: string
  /** Set for browser-like sessions; restore reopens the page instead of a shell. */
  readonly url?: string
  /** Hash of what the session currently shows, for hosts that cannot report activity timestamps. */
  readonly fingerprint?: string
  readonly lastActivityAt?: number
  readonly busy: boolean
  readonly focused: boolean
  readonly agent?: AgentSession
}

export interface WorkspaceState {
  readonly ref: string
  readonly title: string
  readonly path?: string
  readonly branch?: string
  readonly lastActivityAt?: number
  readonly pinned: boolean
  readonly focused: boolean
  /** The host never lets this workspace go away (e.g. a repository's main worktree). */
  readonly permanent: boolean
  readonly sessions: readonly SessionState[]
}

export interface SessionSnapshot {
  readonly ref: string
  readonly title: string
  readonly cwd?: string
  readonly url?: string
  readonly lastActivityAt?: number
  readonly agent?: AgentSession
  readonly hasScrollback: boolean
}

export interface WorkspaceSnapshot {
  readonly ref: string
  readonly title: string
  readonly path?: string
  readonly branch?: string
}

export type ArchiveKind = 'workspace' | 'session'
/**
 * `native`: the host suspended the workspace itself and resumes its sessions when it is shown again.
 * `closed`: tabkeeper closed the sessions and reopens them from the snapshot on restore.
 */
export type ArchiveMode = 'native' | 'closed'
export type ArchiveStatus = 'archived' | 'restored' | 'purged'

export interface ArchiveRecord {
  readonly id: string
  readonly host: HostId
  readonly kind: ArchiveKind
  readonly mode: ArchiveMode
  readonly archivedAt: number
  readonly reason: string
  readonly workspace: WorkspaceSnapshot
  readonly sessions: readonly SessionSnapshot[]
  readonly status: ArchiveStatus
  readonly restoredAt?: number
  readonly purgedAt?: number
}

export function lastActivityOf(workspace: WorkspaceState): number | undefined {
  const stamps = [workspace.lastActivityAt, ...workspace.sessions.map((s) => s.lastActivityAt)]
  const known = stamps.filter((t): t is number => t !== undefined)
  return known.length > 0 ? Math.max(...known) : undefined
}
