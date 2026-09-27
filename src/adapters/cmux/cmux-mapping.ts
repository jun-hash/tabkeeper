import type { SessionState, WorkspaceState } from '../../domain/model.js'
import { agentSession } from '../../shared/agent-resume.js'
import { maxDefined } from '../../shared/collections.js'
import type { CmuxAgentSession, CmuxSurface, CmuxTree, CmuxTreeWorkspace, CmuxWorkspaceDetail } from './cmux-types.js'

export interface CmuxObservations {
  readonly details: ReadonlyMap<string, CmuxWorkspaceDetail>
  readonly agents: readonly CmuxAgentSession[]
  readonly lastEventAt: ReadonlyMap<string, number>
  readonly fingerprints: ReadonlyMap<string, string>
}

export function treeWorkspaces(tree: CmuxTree): CmuxTreeWorkspace[] {
  return tree.windows.flatMap((w) => w.workspaces ?? [])
}

export function treeSurfaces(workspace: CmuxTreeWorkspace): CmuxSurface[] {
  return (workspace.panes ?? []).flatMap((p) => p.surfaces ?? [])
}

export function toWorkspaces(tree: CmuxTree, observations: CmuxObservations): WorkspaceState[] {
  const agentsBySurface = new Map(
    observations.agents.filter((a) => a.surface_id && a.active_for_surface !== false).map((a) => [normalizeId(a.surface_id ?? ''), a]),
  )
  return treeWorkspaces(tree).map((workspace) => toWorkspace(workspace, agentsBySurface, observations))
}

function toWorkspace(
  workspace: CmuxTreeWorkspace,
  agentsBySurface: ReadonlyMap<string, CmuxAgentSession>,
  observations: CmuxObservations,
): WorkspaceState {
  const detail = observations.details.get(normalizeId(workspace.id))
  const path = detail?.current_directory ?? undefined
  const selected = workspace.selected === true
  const lastActivityAt = maxDefined([
    observations.lastEventAt.get(normalizeId(workspace.id)),
    detail?.latest_submitted_at ? Date.parse(detail.latest_submitted_at) : undefined,
  ])

  return {
    ref: workspace.id,
    title: workspace.title || path || 'Workspace',
    ...(path && { path }),
    ...(lastActivityAt !== undefined && { lastActivityAt }),
    pinned: workspace.pinned === true,
    focused: selected,
    permanent: false,
    sessions: treeSurfaces(workspace).map((surface) =>
      toSession(surface, agentsBySurface.get(normalizeId(surface.id)), path, selected, observations),
    ),
  }
}

function toSession(
  surface: CmuxSurface,
  agent: CmuxAgentSession | undefined,
  workspacePath: string | undefined,
  workspaceSelected: boolean,
  observations: CmuxObservations,
): SessionState {
  const cwd = agent?.cwd ?? workspacePath
  const url = surface.type === 'browser' ? surface.url ?? undefined : undefined
  const fingerprint = observations.fingerprints.get(normalizeId(surface.id))
  const resumable = agent ? agentSession(agent.agent, agent.session_id) : undefined
  const lastActivityAt = maxDefined([
    observations.lastEventAt.get(normalizeId(surface.id)),
    agent?.updated_at_unix ? agent.updated_at_unix * 1000 : undefined,
  ])

  return {
    ref: surface.id,
    title: surface.title || (url ?? 'Terminal'),
    ...(cwd && { cwd }),
    ...(url && { url }),
    ...(fingerprint !== undefined && { fingerprint }),
    ...(lastActivityAt !== undefined && { lastActivityAt }),
    busy: agent?.agent_lifecycle === 'running',
    focused: workspaceSelected && surface.focused === true,
    ...(resumable && { agent: resumable }),
  }
}

export function normalizeId(id: string): string {
  return id.toLowerCase()
}
