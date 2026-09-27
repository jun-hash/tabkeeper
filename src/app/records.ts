import type { ArchiveRecord } from '../domain/model.js'
import type { ArchiveStore } from '../ports/archive-store.js'

export class RecordNotFoundError extends Error {
  constructor(query: string) {
    super(`No archive matches "${query}".`)
  }
}

export class AmbiguousRecordError extends Error {
  constructor(query: string, matches: readonly ArchiveRecord[]) {
    super(`"${query}" matches ${matches.length} archives: ${matches.map((r) => r.id).join(', ')}`)
  }
}

/** Resolves a full id or a unique id prefix, like git does for commits. */
export async function resolveRecord(store: ArchiveStore, query: string): Promise<ArchiveRecord> {
  const exact = await store.get(query)
  if (exact) return exact

  const matches = (await store.list()).filter((r) => r.id.startsWith(query))
  const [only] = matches
  if (matches.length === 1 && only) return only
  if (matches.length === 0) throw new RecordNotFoundError(query)
  throw new AmbiguousRecordError(query, matches)
}
