import { describe, expect, it } from 'bun:test'
import { plan } from '../../src/domain/policy.js'
import { DAY, HOUR, NOW, policy, session, workspace } from '../support/builders.js'

const ago = (ms: number) => NOW - ms

describe('plan', () => {
  it('archives a whole workspace once every session has been idle past the workspace threshold', () => {
    const ws = workspace({
      ref: 'w',
      sessions: [
        session({ ref: 'a', lastActivityAt: ago(8 * DAY) }),
        session({ ref: 'b', lastActivityAt: ago(9 * DAY) }),
      ],
    })

    const { actions } = plan([ws], policy(), NOW)

    expect(actions).toEqual([{ kind: 'archive-workspace', workspace: ws, idleMs: 8 * DAY }])
  })

  it('uses the freshest session as the workspace activity', () => {
    const ws = workspace({
      ref: 'w',
      lastActivityAt: ago(30 * DAY),
      sessions: [
        session({ ref: 'old', lastActivityAt: ago(20 * DAY) }),
        session({ ref: 'new', lastActivityAt: ago(1 * HOUR) }),
      ],
    })

    const { actions } = plan([ws], policy(), NOW)

    expect(actions.map((a) => a.kind)).toEqual(['archive-session'])
  })

  it('archives idle sessions inside a live workspace but keeps active ones', () => {
    const idle = session({ ref: 'idle', lastActivityAt: ago(13 * HOUR) })
    const active = session({ ref: 'active', lastActivityAt: ago(1 * HOUR) })
    const ws = workspace({ ref: 'w', sessions: [idle, active] })

    const { actions } = plan([ws], policy(), NOW)

    expect(actions).toEqual([{ kind: 'archive-session', workspace: ws, session: idle, idleMs: 13 * HOUR }])
  })

  it('keeps the most recent session when every session in a surviving workspace is idle', () => {
    const older = session({ ref: 'older', lastActivityAt: ago(20 * HOUR) })
    const newer = session({ ref: 'newer', lastActivityAt: ago(14 * HOUR) })
    const ws = workspace({ ref: 'w', permanent: true, sessions: [older, newer] })

    const { actions, kept } = plan([ws], policy(), NOW)

    expect(actions.map((a) => a.kind === 'archive-session' && a.session.ref)).toEqual(['older'])
    expect(kept).toContainEqual({ workspace: ws, session: newer, protection: 'last-session' })
  })

  it.each([
    ['pinned', { pinned: true }],
    ['protected', { path: '/keep/me' }],
  ] as const)('never touches a %s workspace or its sessions', (protection, overrides) => {
    const ws = workspace({ ref: 'w', ...overrides, sessions: [session({ ref: 's', lastActivityAt: ago(30 * DAY) })] })

    const { actions, kept } = plan([ws], policy({ protectedPaths: ['/keep'] }), NOW)

    expect(actions).toEqual([])
    expect(kept).toEqual([{ workspace: ws, protection }])
  })

  it.each([
    ['permanent', { permanent: true }],
    ['focused', { focused: true }],
  ] as const)('does not archive a %s workspace but still sweeps its idle sessions', (protection, overrides) => {
    const stale = session({ ref: 'stale', lastActivityAt: ago(9 * DAY) })
    const fresh = session({ ref: 'fresh', lastActivityAt: ago(8 * DAY) })
    const ws = workspace({ ref: 'w', ...overrides, sessions: [stale, fresh] })

    const { actions, kept } = plan([ws], policy(), NOW)

    expect(kept).toContainEqual({ workspace: ws, protection })
    expect(actions).toEqual([{ kind: 'archive-session', workspace: ws, session: stale, idleMs: 9 * DAY }])
  })

  it('protects a workspace while any of its sessions runs an agent, and never closes the busy session', () => {
    const busy = session({ ref: 'agent', busy: true, lastActivityAt: ago(10 * DAY) })
    const idle = session({ ref: 'shell', lastActivityAt: ago(10 * DAY) })
    const ws = workspace({ ref: 'w', sessions: [busy, idle] })

    const { actions, kept } = plan([ws], policy(), NOW)

    expect(kept).toContainEqual({ workspace: ws, protection: 'busy' })
    expect(kept).toContainEqual({ workspace: ws, session: busy, protection: 'busy' })
    expect(actions).toEqual([{ kind: 'archive-session', workspace: ws, session: idle, idleMs: 10 * DAY }])
  })

  it('leaves sessions alone when the host cannot tell their activity', () => {
    const unknown = session({ ref: 'unknown', lastActivityAt: undefined })
    const ws = workspace({ ref: 'w', sessions: [unknown] })

    const { actions, kept } = plan([ws], policy(), NOW)

    expect(actions).toEqual([])
    expect(kept).toEqual([{ workspace: ws, session: unknown, protection: 'activity-unknown' }])
  })

  it('protects sessions whose title matches a protected pattern', () => {
    const server = session({ ref: 'srv', title: 'npm run dev', lastActivityAt: ago(20 * HOUR) })
    const other = session({ ref: 'other', lastActivityAt: ago(1 * HOUR) })
    const ws = workspace({ ref: 'w', sessions: [server, other] })

    const { actions, kept } = plan([ws], policy({ protectedTitles: [/run dev/] }), NOW)

    expect(actions).toEqual([])
    expect(kept).toEqual([{ workspace: ws, session: server, protection: 'protected' }])
  })

  it('archives an empty workspace that has been idle past the threshold', () => {
    const ws = workspace({ ref: 'w', lastActivityAt: ago(8 * DAY) })

    expect(plan([ws], policy(), NOW).actions).toEqual([{ kind: 'archive-workspace', workspace: ws, idleMs: 8 * DAY }])
  })

  it('matches protected paths on directory boundaries only', () => {
    const sibling = workspace({ ref: 'w', path: '/keep-not', lastActivityAt: ago(8 * DAY) })

    expect(plan([sibling], policy({ protectedPaths: ['/keep'] }), NOW).actions).toHaveLength(1)
  })

  it.each([
    ['protected', session({ ref: 'srv', title: 'npm run dev', lastActivityAt: NOW - 9 * DAY })],
    ['activity-unknown', session({ ref: 'quiet', lastActivityAt: undefined })],
    ['focused', session({ ref: 'seen', focused: true, lastActivityAt: NOW - 9 * DAY })],
  ] as const)('does not archive an idle workspace whose sessions include a %s one', (protection, special) => {
    const idle = session({ ref: 'idle', lastActivityAt: NOW - 8 * DAY })
    const ws = workspace({ ref: 'w', sessions: [idle, special] })

    const { actions, kept } = plan([ws], policy({ protectedTitles: [/run dev/] }), NOW)

    expect(kept).toContainEqual({ workspace: ws, protection })
    expect(actions.every((a) => a.kind === 'archive-session')).toBe(true)
  })
})
