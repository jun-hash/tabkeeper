import { readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSession, SessionState } from '../domain/model.js'
import type { AgentLocator } from '../ports/agent-locator.js'
import { agentSession } from '../shared/agent-resume.js'

const DEFAULT_TOLERANCE_MS = 2 * 60_000

/**
 * Claude Code writes each conversation to `~/.claude/projects/<realpath(cwd), non-alphanumerics as "-">/<id>.jsonl`.
 * A terminal is matched to a conversation only when exactly one transcript in its cwd was last written
 * around the terminal's last output — ambiguity yields no match rather than resuming the wrong chat.
 */
export class ClaudeCodeLocator implements AgentLocator {
  constructor(
    private readonly projectsDir: string,
    private readonly toleranceMs = DEFAULT_TOLERANCE_MS,
  ) {}

  async locate(session: SessionState): Promise<AgentSession | undefined> {
    const { cwd: rawCwd, lastActivityAt: activity } = session
    if (rawCwd === undefined || activity === undefined) return undefined
    const cwd = await realpath(rawCwd).catch(() => rawCwd)
    const dir = join(this.projectsDir, cwd.replace(/[^a-zA-Z0-9]/g, '-'))

    const names = await readdir(dir).catch(() => [] as string[])
    const transcripts = await Promise.all(
      names
        .filter((name) => name.endsWith('.jsonl'))
        .map(async (name) => ({ id: name.slice(0, -'.jsonl'.length), mtime: (await stat(join(dir, name))).mtimeMs })),
    )

    const matches = transcripts.filter((t) => Math.abs(t.mtime - activity) <= this.toleranceMs)
    const [only] = matches
    if (matches.length !== 1 || !only) return undefined

    return agentSession('claude', only.id)
  }
}
