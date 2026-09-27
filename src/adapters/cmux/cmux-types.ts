export interface CmuxSurface {
  readonly id: string
  readonly type: string
  readonly title?: string | null
  readonly focused?: boolean
  readonly url?: string | null
}

export interface CmuxTreeWorkspace {
  readonly id: string
  readonly title?: string | null
  readonly selected?: boolean
  readonly pinned?: boolean
  readonly panes?: readonly { readonly surfaces?: readonly CmuxSurface[] }[]
}

export interface CmuxTree {
  readonly windows: readonly { readonly id: string; readonly workspaces?: readonly CmuxTreeWorkspace[] }[]
}

export interface CmuxWorkspaceDetail {
  readonly id: string
  readonly current_directory?: string | null
  readonly latest_submitted_at?: string | null
}

export interface CmuxAgentSession {
  readonly agent: string
  readonly session_id: string
  readonly surface_id?: string | null
  readonly cwd?: string | null
  readonly agent_lifecycle?: string | null
  readonly updated_at_unix?: number | null
  readonly active_for_surface?: boolean
}

export interface CmuxScreen {
  readonly text?: string
}
