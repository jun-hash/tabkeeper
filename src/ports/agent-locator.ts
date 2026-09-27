import type { AgentSession, SessionState } from '../domain/model.js'

export interface AgentLocator {
  locate(session: SessionState): Promise<AgentSession | undefined>
}
