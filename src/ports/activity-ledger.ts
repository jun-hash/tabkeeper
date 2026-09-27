export interface Observation {
  readonly fingerprint: string
  readonly since: number
}

/** Remembers, per host session, what it last showed and since when — the activity clock for hosts without one. */
export interface ActivityLedger {
  read(host: string): Promise<ReadonlyMap<string, Observation>>
  write(host: string, observations: ReadonlyMap<string, Observation>): Promise<void>
}
