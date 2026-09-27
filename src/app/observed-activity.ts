import type { HostId, SessionState, WorkspaceState } from '../domain/model.js'
import type { ActivityLedger, Observation } from '../ports/activity-ledger.js'
import { maxDefined } from '../shared/collections.js'

/**
 * Turns content fingerprints into activity timestamps: a session counts as active since the first sweep
 * that saw its current content. Sessions without a fingerprint pass through untouched.
 */
export class ObservedActivity {
  constructor(
    private readonly ledger: ActivityLedger,
    private readonly clock: () => number,
  ) {}

  async apply(host: HostId, workspaces: readonly WorkspaceState[], { persist = true } = {}): Promise<WorkspaceState[]> {
    const previous = await this.ledger.read(host)
    const next = new Map<string, Observation>()
    const now = this.clock()

    const observe = (session: SessionState): SessionState => {
      const { fingerprint } = session
      if (fingerprint === undefined) return session
      const prior = previous.get(session.ref)
      const since = prior?.fingerprint === fingerprint ? prior.since : now
      next.set(session.ref, { fingerprint, since })
      return { ...session, lastActivityAt: maxDefined([session.lastActivityAt, since]) ?? since }
    }

    const observed = workspaces.map((w) => ({ ...w, sessions: w.sessions.map(observe) }))
    if (persist && (next.size > 0 || previous.size > 0)) await this.ledger.write(host, next)
    return observed
  }
}
