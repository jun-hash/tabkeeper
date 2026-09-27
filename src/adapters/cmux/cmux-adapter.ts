import { createHash } from 'node:crypto'
import type { ArchiveMode, SessionState, WorkspaceSnapshot, WorkspaceState } from '../../domain/model.js'
import type { Availability, HostAdapter, SessionSpec } from '../../ports/host-adapter.js'
import { messageOf } from '../../shared/errors.js'
import type { CmuxCli } from './cmux-cli.js'
import { readLastEventTimes } from './cmux-events.js'
import { normalizeId, toWorkspaces, treeSurfaces, treeWorkspaces } from './cmux-mapping.js'
import type { CmuxAgentSession, CmuxScreen, CmuxTree, CmuxWorkspaceDetail } from './cmux-types.js'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export class CmuxAdapter implements HostAdapter {
  readonly id = 'cmux'

  constructor(
    private readonly cli: CmuxCli,
    private readonly eventsPath: string,
  ) {}

  async probe(): Promise<Availability> {
    try {
      await this.cli.exec(['ping'])
      return { available: true }
    } catch (error) {
      return { available: false, reason: messageOf(error) }
    }
  }

  async inventory(): Promise<readonly WorkspaceState[]> {
    const tree = await this.cli.json<CmuxTree>(['tree', '--all'])
    const [details, agents, lastEventAt, fingerprints] = await Promise.all([
      this.readDetails(tree),
      this.cli.json<{ sessions: CmuxAgentSession[] }>(['sessions', 'list', '--all']).then((r) => r.sessions, () => []),
      readLastEventTimes(this.eventsPath),
      this.fingerprint(tree),
    ])
    return toWorkspaces(tree, { details, agents, lastEventAt, fingerprints })
  }

  async readScrollback(workspace: WorkspaceState, session: SessionState, lines: number): Promise<string | undefined> {
    if (session.url !== undefined) return undefined
    const screen = await this.cli.json<CmuxScreen>([
      'read-screen', '--workspace', workspace.ref, '--surface', session.ref, '--scrollback', '--lines', String(lines),
    ])
    return screen.text?.trim() ? screen.text : undefined
  }

  async closeSession(workspace: WorkspaceState, session: SessionState): Promise<void> {
    await this.cli.exec(['close-surface', '--workspace', workspace.ref, '--surface', session.ref])
  }

  async archiveWorkspace(workspace: WorkspaceState): Promise<ArchiveMode> {
    await this.cli.exec(['close-workspace', '--workspace', workspace.ref])
    return 'closed'
  }

  async restore(snapshot: WorkspaceSnapshot, sessions: readonly SessionSpec[]): Promise<void> {
    const tree = await this.cli.json<CmuxTree>(['tree', '--all'])
    const open = treeWorkspaces(tree).find((w) => normalizeId(w.id) === normalizeId(snapshot.ref))
    if (open) {
      for (const spec of sessions) await this.openSurface(open.id, spec)
      return
    }

    const [first, ...rest] = sessions
    const cwd = first?.cwd ?? snapshot.path
    const output = await this.cli.exec([
      '--json', '--id-format', 'uuids', 'workspace', 'create', '--name', snapshot.title,
      ...(cwd ? ['--cwd', cwd] : []), '--focus', 'false',
    ])
    const created = parseCreated(output)
    const workspaceId = required(created.workspace, 'workspace', output)
    const initialSurface = created.surface

    // A new workspace already has one terminal; reuse it for the first shell session instead of leaving it blank.
    if (first && first.url === undefined && initialSurface) await this.prepare(workspaceId, initialSurface, first)
    else if (first) await this.openSurface(workspaceId, first)
    for (const spec of rest) await this.openSurface(workspaceId, spec)
  }

  private async openSurface(workspaceId: string, spec: SessionSpec): Promise<void> {
    if (spec.url !== undefined) {
      await this.cli.exec(['new-surface', '--workspace', workspaceId, '--type', 'browser', '--url', spec.url])
      return
    }
    const cwd = spec.cwd ? ['--working-directory', spec.cwd] : []
    const output = await this.cli.exec([
      '--json', '--id-format', 'uuids', 'new-surface', '--workspace', workspaceId, '--type', 'terminal', ...cwd,
    ])
    await this.prepare(workspaceId, required(parseCreated(output).surface, 'surface', output), spec)
  }

  private async prepare(workspaceId: string, surfaceId: string, spec: SessionSpec): Promise<void> {
    const target = ['--workspace', workspaceId, '--surface', surfaceId]
    await this.cli.exec(['rename-tab', ...target, spec.title])
    // The cmux CLI turns a literal "\n" into Enter.
    if (spec.command) await this.cli.exec(['send', ...target, `${spec.command}\\n`])
  }

  private async readDetails(tree: CmuxTree): Promise<Map<string, CmuxWorkspaceDetail>> {
    const lists = await Promise.all(
      tree.windows.map((w) =>
        this.cli.json<{ workspaces: CmuxWorkspaceDetail[] }>(['workspace', 'list', '--window', w.id]).then(
          (r) => r.workspaces,
          () => [],
        ),
      ),
    )
    return new Map(lists.flat().map((d) => [normalizeId(d.id), d]))
  }

  /** Hashes each terminal's visible screen so tabkeeper can tell when it last changed. */
  private async fingerprint(tree: CmuxTree): Promise<Map<string, string>> {
    const targets = treeWorkspaces(tree).flatMap((w) =>
      treeSurfaces(w)
        .filter((s) => s.type === 'terminal')
        .map((s) => ({ workspace: w.id, surface: s.id })),
    )
    const entries = await Promise.all(
      targets.map(async ({ workspace, surface }) => {
        const screen = await this.cli
          .json<CmuxScreen>(['read-screen', '--workspace', workspace, '--surface', surface])
          .catch(() => undefined)
        const text = screen?.text
        return text === undefined ? undefined : ([normalizeId(surface), hash(text)] as const)
      }),
    )
    return new Map(entries.filter((e) => e !== undefined))
  }
}

interface CreatedHandles {
  readonly workspace?: string
  readonly surface?: string
}

/** Newer cmux builds answer create commands with JSON; older ones print `OK workspace:3 surface:7`. */
export function parseCreated(output: string): CreatedHandles {
  try {
    const json = JSON.parse(output) as { workspace_id?: string; surface_id?: string }
    return { ...(json.workspace_id && { workspace: json.workspace_id }), ...(json.surface_id && { surface: json.surface_id }) }
  } catch {
    const find = (kind: string) => output.match(new RegExp(`${kind}[=:\\s]+(${UUID})`, 'i'))?.[1] ?? output.match(new RegExp(`${kind}:\\d+`))?.[0]
    const workspace = find('workspace')
    const surface = find('surface')
    return { ...(workspace && { workspace }), ...(surface && { surface }) }
  }
}

function required(handle: string | undefined, kind: string, output: string): string {
  if (!handle) throw new Error(`cmux did not report the new ${kind}: ${output.trim().slice(0, 200)}`)
  return handle
}

function hash(text: string): string {
  return createHash('sha1').update(text.replace(/\s+$/g, '')).digest('hex')
}
