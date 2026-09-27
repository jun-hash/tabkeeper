import { basename } from 'node:path'
import type { AgentSession, SessionState, WorkspaceState } from '../../domain/model.js'
import { agentSession } from '../../shared/agent-resume.js'
import { groupBy, maxDefined } from '../../shared/collections.js'
import type { OrcaHookEntry, OrcaTerminal, OrcaWorktree } from './orca-types.js'

const IDLE_TITLE_MARK = '✳'
const BRAILLE_SPINNER = /^[⠁-⣿]/
const WORKING_HOOK_STATES = new Set(['working', 'blocked'])
const HANDLE_SEPARATOR = ','

export function toWorkspaces(
  worktrees: readonly OrcaWorktree[],
  terminals: readonly OrcaTerminal[],
  hooks: ReadonlyMap<string, AgentSession>,
): WorkspaceState[] {
  const terminalsByWorktree = groupBy(terminals, (t) => t.worktreeId)
  return worktrees
    .filter((w) => !w.isArchived)
    .map((worktree) => toWorkspace(worktree, terminalsByWorktree.get(worktree.worktreeId) ?? [], hooks))
}

export function toHookSessions(entries: Readonly<Record<string, OrcaHookEntry>>): Map<string, AgentSession> {
  const sessions = new Map<string, AgentSession>()
  for (const [paneKey, entry] of Object.entries(entries)) {
    const id = entry.providerSession?.id
    const session = entry.source && id ? agentSession(entry.source, id) : undefined
    if (session) sessions.set(paneKey, session)
  }
  return sessions
}

/** A session ref is the comma-joined handles of every pane in one Orca tab. */
export function handlesOf(sessionRef: string): string[] {
  return sessionRef.split(HANDLE_SEPARATOR).filter(Boolean)
}

export function worktreeSelector(worktreeId: string): string {
  return `id:${worktreeId}`
}

export function cleanTitle(title: string): string {
  return title.replace(/^[⠀-⣿✳◐◑◒◓·•\s]+/u, '').trim()
}

function toWorkspace(
  worktree: OrcaWorktree,
  terminals: readonly OrcaTerminal[],
  hooks: ReadonlyMap<string, AgentSession>,
): WorkspaceState {
  const hookStates = new Map((worktree.agents ?? []).map((a) => [a.paneKey, a.state]))
  const sessions = [...groupBy(terminals, (t) => t.tabId).values()].map((panes) => toSession(panes, hookStates, hooks))
  const lastActivityAt = maxDefined([worktree.lastActivityAt, worktree.lastOutputAt])
  const branch = worktree.branch?.replace(/^refs\/heads\//, '')

  return {
    ref: worktreeSelector(worktree.worktreeId),
    title: worktree.displayName || basename(worktree.path),
    path: worktree.path,
    ...(branch && { branch }),
    ...(lastActivityAt !== undefined && { lastActivityAt }),
    pinned: worktree.isPinned,
    focused: worktree.isActive === true,
    permanent: worktree.isMainWorktree,
    sessions,
  }
}

function toSession(
  panes: readonly OrcaTerminal[],
  hookStates: ReadonlyMap<string, string>,
  hooks: ReadonlyMap<string, AgentSession>,
): SessionState {
  const keys = panes.map(paneKey)
  const agent = keys.map((key) => hooks.get(key)).find((a) => a !== undefined)
  const lastActivityAt = maxDefined(panes.map((p) => p.lastOutputAt))
  const [first] = panes

  return {
    ref: panes.map((p) => p.handle).join(HANDLE_SEPARATOR),
    title: cleanTitle(first?.title ?? '') || 'Terminal',
    ...(first && { cwd: first.worktreePath }),
    ...(lastActivityAt !== undefined && { lastActivityAt }),
    busy: panes.some((pane) => isBusy(pane.title, hookStates.get(paneKey(pane)))),
    focused: false,
    ...(agent && { agent }),
  }
}

/** Title marks are live; hook states can go stale, so an idle title mark overrides a "working" hook. */
function isBusy(title: string, hookState: string | undefined): boolean {
  if (BRAILLE_SPINNER.test(title)) return true
  if (title.startsWith(IDLE_TITLE_MARK)) return false
  return hookState !== undefined && WORKING_HOOK_STATES.has(hookState)
}

function paneKey(terminal: OrcaTerminal): string {
  return `${terminal.tabId}:${terminal.leafId}`
}
