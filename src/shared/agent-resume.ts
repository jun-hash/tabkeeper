import type { AgentSession } from '../domain/model.js'

const RESUME_COMMANDS: Readonly<Record<string, (sessionId: string) => string>> = {
  claude: (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`,
  opencode: (id) => `opencode --session ${id}`,
}

export function agentSession(tool: string, sessionId: string): AgentSession | undefined {
  const build = RESUME_COMMANDS[tool]
  if (!build || !/^[\w.:-]+$/.test(sessionId)) return undefined
  return { tool, sessionId, resumeCommand: build(sessionId) }
}
