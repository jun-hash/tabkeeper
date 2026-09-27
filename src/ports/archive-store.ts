import type { ArchiveRecord, ArchiveStatus, HostId } from '../domain/model.js'

export interface RecordFilter {
  readonly host?: HostId
  readonly status?: ArchiveStatus
}

export interface Release {
  (): Promise<void>
}

export interface ArchiveStore {
  save(record: ArchiveRecord, scrollback: ReadonlyMap<string, string>): Promise<void>
  update(record: ArchiveRecord): Promise<void>
  remove(id: string): Promise<void>
  get(id: string): Promise<ArchiveRecord | undefined>
  list(filter?: RecordFilter): Promise<readonly ArchiveRecord[]>
  scrollback(id: string, sessionRef: string): Promise<string | undefined>
  /** Acquires an exclusive lock so overlapping sweeps (e.g. cron + manual) never race. */
  lock(): Promise<Release>
}
