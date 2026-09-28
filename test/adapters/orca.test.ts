import { describe, expect, it } from 'bun:test'
import { OrcaAdapter } from '../../src/adapters/orca/orca-adapter.js'
import { OrcaCli, OrcaError } from '../../src/adapters/orca/orca-cli.js'
import { PartialArchiveError } from '../../src/ports/host-adapter.js'
import { cleanTitle, toHookSessions, toWorkspaces } from '../../src/adapters/orca/orca-mapping.js'
import type { OrcaRuntime } from '../../src/adapters/orca/orca-runtime.js'
import type { OrcaTerminal, OrcaWorktree } from '../../src/adapters/orca/orca-types.js'
import { scriptedRunner } from '../support/fakes.js'

const WT = 'repo-1::/work/feature'

const worktree = (overrides: Partial<OrcaWorktree> = {}): OrcaWorktree => ({
  worktreeId: WT,
  path: '/work/feature',
  branch: 'refs/heads/feature',
  displayName: 'Feature',
  isArchived: false,
  isMainWorktree: false,
  isPinned: false,
  isActive: false,
  lastActivityAt: 1_000,
  lastOutputAt: 5_000,
  agents: [],
  ...overrides,
})

const terminal = (handle: string, tabId: string, overrides: Partial<OrcaTerminal> = {}): OrcaTerminal => ({
  handle,
  worktreeId: WT,
  worktreePath: '/work/feature',
  tabId,
  leafId: `${handle}-leaf`,
  title: '✳ Fix login',
  lastOutputAt: 4_000,
  ...overrides,
})

const ok = (result: unknown) => JSON.stringify({ ok: true, result })

describe('orca mapping', () => {
  it('groups panes into one session per tab and derives activity from terminal output', () => {
    const [ws] = toWorkspaces(
      [worktree()],
      [
        terminal('t1', 'tab-a', { lastOutputAt: 3_000 }),
        terminal('t2', 'tab-a', { lastOutputAt: 4_500 }),
        terminal('t3', 'tab-b'),
      ],
      new Map(),
    )

    expect(ws).toMatchObject({ ref: `id:${WT}`, title: 'Feature', branch: 'feature', lastActivityAt: 5_000 })
    expect(ws?.sessions.map((s) => [s.ref, s.title, s.lastActivityAt])).toEqual([
      ['t1,t2', 'Fix login', 4_500],
      ['t3', 'Fix login', 4_000],
    ])
  })

  it('treats a spinner title or a live "working" hook as busy, but trusts an idle title over a stale hook', () => {
    const agents = [
      { paneKey: 'tab-a:t1-leaf', state: 'working' },
      { paneKey: 'tab-b:t2-leaf', state: 'working' },
    ]
    const [ws] = toWorkspaces(
      [worktree({ agents })],
      [
        terminal('t1', 'tab-a', { title: 'Fix login' }),
        terminal('t2', 'tab-b', { title: '✳ Done' }),
        terminal('t3', 'tab-c', { title: '⠋ Thinking' }),
      ],
      new Map(),
    )

    expect(ws?.sessions.map((s) => s.busy)).toEqual([true, false, true])
  })

  it('skips worktrees Orca already archived and marks main worktrees permanent', () => {
    const workspaces = toWorkspaces(
      [worktree({ isArchived: true }), worktree({ worktreeId: 'repo::/main', isMainWorktree: true, isPinned: true })],
      [],
      new Map(),
    )
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0]).toMatchObject({ permanent: true, pinned: true })
  })

  it('reads resumable agent sessions from Orca hook state', () => {
    const hooks = toHookSessions({
      'tab-a:t1-leaf': { source: 'claude', providerSession: { id: 'c-1' } },
      'tab-b:x': { source: 'mystery', providerSession: { id: 'm-1' } },
    })
    const [ws] = toWorkspaces([worktree()], [terminal('t1', 'tab-a')], hooks)

    expect(ws?.sessions[0]?.agent).toEqual({ tool: 'claude', sessionId: 'c-1', resumeCommand: 'claude --resume c-1' })
    expect(hooks.size).toBe(1)
  })

  it('strips status marks from titles', () => {
    expect(['✳ Fix', '⠙ Build', '◐ Plan', 'Plain'].map(cleanTitle)).toEqual(['Fix', 'Build', 'Plan', 'Plain'])
  })
})

describe('OrcaAdapter', () => {
  function adapter(responders: Parameters<typeof scriptedRunner>[0], runtime: Partial<OrcaRuntime> = {}) {
    const { runner, calls } = scriptedRunner(responders)
    const rpc: string[] = []
    const fakeRuntime = {
      call: async (method: string, params: unknown) => {
        rpc.push(`${method} ${JSON.stringify(params)}`)
        return undefined
      },
      ...runtime,
    } as OrcaRuntime
    return { orca: new OrcaAdapter(new OrcaCli(runner, 'orca'), fakeRuntime, '/nonexistent'), calls, rpc }
  }

  it('reports the runtime error when Orca is not running', async () => {
    const { orca } = adapter({
      status: () => ({
        exitCode: 1,
        stdout: JSON.stringify({
          ok: false,
          error: { code: 'runtime_unavailable', message: 'Start the Orca app first.' },
        }),
      }),
    })
    expect(await orca.probe()).toEqual({
      available: false,
      reason: 'orca: Start the Orca app first. (runtime_unavailable)',
    })
  })

  it('closes a whole tab through any of its pane handles', async () => {
    const { orca, calls } = adapter({ 'terminal close': () => ok({}) })
    const ws = toWorkspaces([worktree()], [terminal('t1', 'tab-a'), terminal('t2', 'tab-a')], new Map())[0]!
    await orca.closeSession(ws, ws.sessions[0]!)

    expect(calls).toEqual([['orca', 'terminal', 'close', '--terminal', 't1', '--tab', '--json']])
  })

  it('hides the worktree with the archive flag, then sleeps it', async () => {
    const { orca, calls, rpc } = adapter({})
    const ws = toWorkspaces([worktree()], [terminal('t1', 'tab-a')], new Map())[0]!

    expect(await orca.archiveWorkspace(ws)).toBe('native')
    expect(rpc).toEqual([
      `worktree.set {"worktree":"id:${WT}","isArchived":true}`,
      `worktree.sleep {"worktree":"id:${WT}"}`,
    ])
    expect(calls).toEqual([])
  })

  const failing = (code: string) => ({
    call: async () => {
      throw new OrcaError(code, code)
    },
  })

  it('falls back to closing tabs only when the runtime certainly did not act', async () => {
    const { orca, calls } = adapter({ 'terminal close': () => ok({}) }, failing('method_not_found'))
    const ws = toWorkspaces([worktree()], [terminal('t1', 'tab-a'), terminal('t2', 'tab-b')], new Map())[0]!

    expect(await orca.archiveWorkspace(ws)).toBe('closed')
    expect(calls.map((c) => c[4])).toEqual(['t1', 't2'])
  })

  it('does not close anything after an ambiguous runtime failure', async () => {
    const { orca, calls } = adapter({}, failing('runtime_timeout'))
    const ws = toWorkspaces([worktree()], [terminal('t1', 'tab-a')], new Map())[0]!

    await expect(orca.archiveWorkspace(ws)).rejects.toThrow('runtime_timeout')
    expect(calls).toEqual([])
  })

  it('reports a partial close when some tabs were already closed', async () => {
    let closes = 0
    const { orca } = adapter(
      {
        'terminal close': () =>
          ++closes === 1
            ? ok({})
            : { exitCode: 1, stdout: JSON.stringify({ ok: false, error: { code: 'x', message: 'boom' } }) },
      },
      failing('runtime_unavailable'),
    )
    const ws = toWorkspaces([worktree()], [terminal('t1', 'tab-a'), terminal('t2', 'tab-b')], new Map())[0]!

    await expect(orca.archiveWorkspace(ws)).rejects.toBeInstanceOf(PartialArchiveError)
  })

  it('refuses to remove a worktree that is no longer archived', async () => {
    const { orca, calls } = adapter({ 'worktree ps': () => ok({ worktrees: [worktree({ isArchived: false })] }) })
    await expect(orca.removeWorkspace({ ref: `id:${WT}`, title: 'Feature', path: '/work/feature' })).rejects.toThrow(
      'in use again',
    )
    expect(calls.some((c) => c.includes('rm'))).toBe(false)
  })

  it('un-archives the worktree and recreates terminals with resume commands', async () => {
    const { orca, calls, rpc } = adapter({
      'worktree ps': () => ok({ worktrees: [worktree({ isArchived: true })] }),
      'terminal create': () => ok({ terminal: { handle: 'new' } }),
    })

    await orca.restore({ ref: `id:${WT}`, title: 'Feature', path: '/work/feature' }, [
      { title: 'Fix login', command: 'claude --resume c-1' },
      { title: 'Shell' },
    ])

    expect(rpc).toEqual([`worktree.set {"worktree":"id:${WT}","isArchived":false}`])
    expect(calls.slice(1)).toEqual([
      [
        'orca',
        'terminal',
        'create',
        '--worktree',
        `id:${WT}`,
        '--title',
        'Fix login',
        '--command',
        'claude --resume c-1',
        '--json',
      ],
      ['orca', 'terminal', 'create', '--worktree', `id:${WT}`, '--title', 'Shell', '--json'],
    ])
  })

  it('refuses to restore into a worktree that no longer exists', async () => {
    const { orca } = adapter({ 'worktree ps': () => ok({ worktrees: [] }) })
    await expect(orca.restore({ ref: 'id:gone', title: 'Gone', path: '/gone' }, [])).rejects.toThrow('no longer has')
  })
})
