import type { AgentSession, SessionSnapshot, SessionState, WorkspaceSnapshot, WorkspaceState } from '../domain/model.js'
import type { AgentLocator } from '../ports/agent-locator.js'
import type { HostAdapter } from '../ports/host-adapter.js'

export interface CapturedSessions {
  readonly sessions: readonly SessionSnapshot[]
  readonly scrollback: ReadonlyMap<string, string>
}

export class SessionCapturer {
  constructor(
    private readonly locators: readonly AgentLocator[],
    private readonly scrollbackLines: number,
  ) {}

  async capture(
    adapter: HostAdapter,
    workspace: WorkspaceState,
    sessions: readonly SessionState[],
  ): Promise<CapturedSessions> {
    const scrollback = new Map<string, string>()
    const snapshots: SessionSnapshot[] = []

    for (const session of sessions) {
      const [text, agent] = await Promise.all([
        this.readScrollback(adapter, workspace, session),
        session.agent ? Promise.resolve(session.agent) : this.locateAgent(session),
      ])
      if (text) scrollback.set(session.ref, text)
      snapshots.push(toSessionSnapshot(session, agent, text !== undefined && text.length > 0))
    }

    return { sessions: snapshots, scrollback }
  }

  private async readScrollback(
    adapter: HostAdapter,
    workspace: WorkspaceState,
    session: SessionState,
  ): Promise<string | undefined> {
    if (this.scrollbackLines <= 0) return undefined
    return adapter.readScrollback(workspace, session, this.scrollbackLines).catch(() => undefined)
  }

  private async locateAgent(session: SessionState): Promise<AgentSession | undefined> {
    for (const locator of this.locators) {
      const found = await locator.locate(session).catch(() => undefined)
      if (found) return found
    }
    return undefined
  }
}

export function toWorkspaceSnapshot(workspace: WorkspaceState): WorkspaceSnapshot {
  return {
    ref: workspace.ref,
    title: workspace.title,
    ...(workspace.path !== undefined && { path: workspace.path }),
    ...(workspace.branch !== undefined && { branch: workspace.branch }),
  }
}

function toSessionSnapshot(
  session: SessionState,
  agent: AgentSession | undefined,
  hasScrollback: boolean,
): SessionSnapshot {
  return {
    ref: session.ref,
    title: session.title,
    ...(session.cwd !== undefined && { cwd: session.cwd }),
    ...(session.url !== undefined && { url: session.url }),
    ...(session.lastActivityAt !== undefined && { lastActivityAt: session.lastActivityAt }),
    ...(agent !== undefined && { agent }),
    hasScrollback,
  }
}
