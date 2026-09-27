export interface Observation {
  readonly fingerprint: string
  readonly since: number
}

export interface ActivityLedger {
  read(host: string): Promise<ReadonlyMap<string, Observation>>
  write(host: string, observations: ReadonlyMap<string, Observation>): Promise<void>
}
