import type { AgentSession, SessionState } from '../domain/model.js'

/** Recovers which coding-agent conversation a terminal session was running, so restore can resume it. */
export interface AgentLocator {
  locate(session: SessionState): Promise<AgentSession | undefined>
}
