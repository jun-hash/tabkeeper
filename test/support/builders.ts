import type { SessionState, WorkspaceState } from '../../src/domain/model.js'
import type { Policy } from '../../src/domain/policy.js'

export const HOUR = 3_600_000
export const DAY = 24 * HOUR
export const NOW = Date.UTC(2026, 8, 25, 12)

type SessionOverrides = Omit<Partial<SessionState>, 'lastActivityAt'> & { ref: string; lastActivityAt?: number | undefined }

export function session(overrides: SessionOverrides): SessionState {
  const { lastActivityAt, ...rest } = overrides
  const base = { title: rest.ref, busy: false, focused: false, ...rest }
  if ('lastActivityAt' in overrides && lastActivityAt === undefined) return base
  return { ...base, lastActivityAt: lastActivityAt ?? NOW }
}

export function workspace(overrides: Partial<WorkspaceState> & { ref: string }): WorkspaceState {
  return {
    title: overrides.ref,
    path: `/work/${overrides.ref}`,
    pinned: false,
    focused: false,
    permanent: false,
    sessions: [],
    ...overrides,
  }
}

export function policy(overrides: Partial<Policy> = {}): Policy {
  return { sessionIdleMs: 12 * HOUR, workspaceIdleMs: 7 * DAY, protectedPaths: [], protectedTitles: [], ...overrides }
}
