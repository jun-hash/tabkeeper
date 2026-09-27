import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CmuxAdapter, parseCreated } from '../../src/adapters/cmux/cmux-adapter.js'
import { CmuxCli } from '../../src/adapters/cmux/cmux-cli.js'
import { readLastEventTimes } from '../../src/adapters/cmux/cmux-events.js'
import { toWorkspaces } from '../../src/adapters/cmux/cmux-mapping.js'
import type { CmuxTree } from '../../src/adapters/cmux/cmux-types.js'
import { scriptedRunner } from '../support/fakes.js'

const WS = 'AAAAAAAA-0000-0000-0000-000000000001'
const TERM = 'BBBBBBBB-0000-0000-0000-000000000001'
const WEB = 'BBBBBBBB-0000-0000-0000-000000000002'

const tree: CmuxTree = {
  windows: [
    {
      id: 'win-1',
      workspaces: [
        {
          id: WS,
          title: 'api',
          selected: true,
          pinned: false,
          panes: [
            {
              surfaces: [
                { id: TERM, type: 'terminal', title: 'claude', focused: false },
                { id: WEB, type: 'browser', title: 'Docs', focused: true, url: 'https://example.com' },
              ],
            },
          ],
        },
      ],
    },
  ],
}

describe('cmux mapping', () => {
  it('builds sessions from the tree, agent records, events and fingerprints', () => {
    const [ws] = toWorkspaces(tree, {
      details: new Map([
        [WS.toLowerCase(), { id: WS, current_directory: '/work/api', latest_submitted_at: '2026-09-25T10:00:00Z' }],
      ]),
      agents: [
        {
          agent: 'claude',
          session_id: 'c-9',
          surface_id: TERM,
          agent_lifecycle: 'running',
          updated_at_unix: 1_000,
          active_for_surface: true,
        },
      ],
      lastEventAt: new Map([[TERM.toLowerCase(), 2_000_000]]),
      fingerprints: new Map([[TERM.toLowerCase(), 'hash']]),
    })

    expect(ws).toMatchObject({
      ref: WS,
      title: 'api',
      path: '/work/api',
      focused: true,
      lastActivityAt: Date.parse('2026-09-25T10:00:00Z'),
    })
    expect(ws?.sessions[0]).toMatchObject({
      ref: TERM,
      cwd: '/work/api',
      busy: true,
      focused: false,
      fingerprint: 'hash',
      lastActivityAt: 2_000_000,
      agent: { resumeCommand: 'claude --resume c-9' },
    })
    expect(ws?.sessions[1]).toMatchObject({ ref: WEB, url: 'https://example.com', focused: true, busy: false })
  })
})

describe('readLastEventTimes', () => {
  it('keeps the newest timestamp per workspace and surface id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cmux-'))
    const file = join(dir, 'events.jsonl')
    await writeFile(
      file,
      [
        'partial line from a cut-off tail',
        JSON.stringify({ occurred_at: '2026-09-25T10:00:00Z', workspace_id: WS, surface_id: TERM }),
        JSON.stringify({ occurred_at: '2026-09-25T09:00:00Z', workspace_id: WS, surface_id: null }),
        JSON.stringify({ occurred_at: 'garbage', workspace_id: WS }),
      ].join('\n'),
    )

    const latest = await readLastEventTimes(file)

    expect(latest.get(WS.toLowerCase())).toBe(Date.parse('2026-09-25T10:00:00Z'))
    expect(latest.get(TERM.toLowerCase())).toBe(Date.parse('2026-09-25T10:00:00Z'))
  })

  it('returns nothing when the log is missing', async () => {
    expect((await readLastEventTimes('/nonexistent/events.jsonl')).size).toBe(0)
  })
})

describe('parseCreated', () => {
  it.each([
    [JSON.stringify({ workspace_id: WS, surface_id: TERM }), { workspace: WS, surface: TERM }],
    [`OK workspace=${WS} surface=${TERM}`, { workspace: WS, surface: TERM }],
    ['OK workspace:3', { workspace: 'workspace:3' }],
    ['OK surface:7', { surface: 'surface:7' }],
  ])('reads %s', (output, expected) => expect(parseCreated(output)).toEqual(expected))
})

describe('CmuxAdapter.restore', () => {
  it('recreates a closed workspace, reusing its first terminal for the first session', async () => {
    const { runner, calls } = scriptedRunner({
      'tree --all': () => JSON.stringify({ windows: [] }),
      'workspace create': () => JSON.stringify({ workspace_id: WS, surface_id: TERM }),
      'new-surface': () => JSON.stringify({ surface_id: WEB }),
    })
    const cmux = new CmuxAdapter(new CmuxCli(runner, 'cmux'), '/nonexistent')

    await cmux.restore({ ref: 'old-id', title: 'api', path: '/work/api' }, [
      { title: 'agent', cwd: '/work/api', command: 'claude --resume c-9' },
      { title: 'Docs', url: 'https://example.com' },
    ])

    expect(calls.slice(1).map((c) => c.slice(1).join(' '))).toEqual([
      '--json --id-format uuids workspace create --name api --cwd /work/api --focus false',
      `rename-tab --workspace ${WS} --surface ${TERM} agent`,
      `send --workspace ${WS} --surface ${TERM} claude --resume c-9\\n`,
      `new-surface --workspace ${WS} --type browser --url https://example.com`,
    ])
  })

  it('adds sessions to a workspace that is still open', async () => {
    const { runner, calls } = scriptedRunner({
      'tree --all': () => JSON.stringify(tree),
      'new-surface': () => JSON.stringify({ surface_id: 'NEW' }),
    })
    const cmux = new CmuxAdapter(new CmuxCli(runner, 'cmux'), '/nonexistent')

    await cmux.restore({ ref: WS.toLowerCase(), title: 'api' }, [{ title: 'shell', cwd: '/work/api' }])

    expect(calls.slice(1).map((c) => c.slice(1).join(' '))).toEqual([
      `--json --id-format uuids new-surface --workspace ${WS} --type terminal --working-directory /work/api`,
      `rename-tab --workspace ${WS} --surface NEW shell`,
    ])
  })
})
