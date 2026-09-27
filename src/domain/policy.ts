import { lastActivityOf, type SessionState, type WorkspaceState } from './model.js'

export interface Policy {
  readonly sessionIdleMs: number
  readonly workspaceIdleMs: number
  readonly protectedPaths: readonly string[]
  readonly protectedTitles: readonly RegExp[]
}

export type Protection = 'pinned' | 'protected' | 'permanent' | 'focused' | 'busy' | 'activity-unknown' | 'last-session'

export type Action =
  | { readonly kind: 'archive-workspace'; readonly workspace: WorkspaceState; readonly idleMs: number }
  | {
      readonly kind: 'archive-session'
      readonly workspace: WorkspaceState
      readonly session: SessionState
      readonly idleMs: number
    }

export interface Kept {
  readonly workspace: WorkspaceState
  readonly session?: SessionState
  readonly protection: Protection
}

export interface Plan {
  readonly actions: readonly Action[]
  readonly kept: readonly Kept[]
}

interface IdleSession {
  readonly session: SessionState
  readonly idleMs: number
}

export function plan(workspaces: readonly WorkspaceState[], policy: Policy, now: number): Plan {
  const actions: Action[] = []
  const kept: Kept[] = []

  for (const workspace of workspaces) {
    const guard = subtreeGuard(workspace, policy)
    if (guard) {
      if (hasIdleWork(workspace, policy, now)) kept.push({ workspace, protection: guard })
      continue
    }

    const workspaceIdle = idleSince(lastActivityOf(workspace), now)
    if (workspaceIdle !== undefined && workspaceIdle >= policy.workspaceIdleMs) {
      const blocker = workspaceBlocker(workspace, policy)
      if (!blocker) {
        actions.push({ kind: 'archive-workspace', workspace, idleMs: workspaceIdle })
        continue
      }
      kept.push({ workspace, protection: blocker })
    }

    const { idle, protectedSessions } = classifySessions(workspace, policy, now)
    kept.push(...protectedSessions)

    if (idle.length > 0 && idle.length === workspace.sessions.length) {
      const freshest = idle.reduce((a, b) => (b.idleMs < a.idleMs ? b : a))
      idle.splice(idle.indexOf(freshest), 1)
      kept.push({ workspace, session: freshest.session, protection: 'last-session' })
    }

    for (const { session, idleMs } of idle) {
      actions.push({ kind: 'archive-session', workspace, session, idleMs })
    }
  }

  return { actions, kept }
}

function subtreeGuard(workspace: WorkspaceState, policy: Policy): Protection | undefined {
  if (workspace.pinned) return 'pinned'
  if (isProtectedPath(workspace.path, policy) || isProtectedTitle(workspace.title, policy)) return 'protected'
  return undefined
}

/** Archiving a workspace closes every session in it, so any session-level protection blocks it too. */
function workspaceBlocker(workspace: WorkspaceState, policy: Policy): Protection | undefined {
  if (workspace.permanent) return 'permanent'
  if (workspace.focused) return 'focused'
  const { sessions } = workspace
  if (sessions.some((s) => s.busy)) return 'busy'
  if (sessions.some((s) => s.focused)) return 'focused'
  if (sessions.some((s) => isProtectedTitle(s.title, policy))) return 'protected'
  if (sessions.some((s) => s.lastActivityAt === undefined)) return 'activity-unknown'
  return undefined
}

function classifySessions(
  workspace: WorkspaceState,
  policy: Policy,
  now: number,
): { idle: IdleSession[]; protectedSessions: Kept[] } {
  const idle: IdleSession[] = []
  const protectedSessions: Kept[] = []

  for (const session of workspace.sessions) {
    const idleMs = idleSince(session.lastActivityAt, now)
    if (idleMs === undefined) {
      protectedSessions.push({ workspace, session, protection: 'activity-unknown' })
      continue
    }
    if (idleMs < policy.sessionIdleMs) continue

    const blocker = sessionBlocker(session, policy)
    if (blocker) protectedSessions.push({ workspace, session, protection: blocker })
    else idle.push({ session, idleMs })
  }

  return { idle, protectedSessions }
}

function sessionBlocker(session: SessionState, policy: Policy): Protection | undefined {
  if (session.busy) return 'busy'
  if (session.focused) return 'focused'
  if (isProtectedTitle(session.title, policy)) return 'protected'
  return undefined
}

function hasIdleWork(workspace: WorkspaceState, policy: Policy, now: number): boolean {
  const workspaceIdle = idleSince(lastActivityOf(workspace), now)
  if (workspaceIdle !== undefined && workspaceIdle >= policy.workspaceIdleMs) return true
  return workspace.sessions.some((s) => (idleSince(s.lastActivityAt, now) ?? 0) >= policy.sessionIdleMs)
}

function idleSince(timestamp: number | undefined, now: number): number | undefined {
  return timestamp === undefined ? undefined : Math.max(0, now - timestamp)
}

function isProtectedPath(path: string | undefined, policy: Policy): boolean {
  if (path === undefined) return false
  return policy.protectedPaths.some((root) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`))
}

function isProtectedTitle(title: string, policy: Policy): boolean {
  return policy.protectedTitles.some((pattern) => pattern.test(title))
}
