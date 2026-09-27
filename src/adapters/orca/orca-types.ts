export interface OrcaEnvelope<T> {
  readonly ok: boolean
  readonly result?: T
  readonly error?: { readonly code: string; readonly message: string }
}

export interface OrcaAgentStatus {
  readonly paneKey: string
  readonly state: string
  readonly agentType?: string
}

export interface OrcaWorktree {
  readonly worktreeId: string
  readonly path: string
  readonly branch?: string | null
  readonly displayName?: string | null
  readonly isArchived: boolean
  readonly isMainWorktree: boolean
  readonly isPinned: boolean
  readonly isActive?: boolean
  readonly lastActivityAt?: number
  readonly lastOutputAt?: number | null
  readonly agents?: readonly OrcaAgentStatus[]
}

export interface OrcaTerminal {
  readonly handle: string
  readonly worktreeId: string
  readonly worktreePath: string
  readonly tabId: string
  readonly leafId: string
  readonly title: string
  readonly lastOutputAt?: number | null
}

export interface OrcaTerminalRead {
  readonly terminal: { readonly tail: readonly string[] }
}

export interface OrcaHookEntry {
  readonly source?: string
  readonly providerSession?: { readonly id?: string }
}
