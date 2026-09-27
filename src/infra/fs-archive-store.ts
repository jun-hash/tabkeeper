import { createHash } from 'node:crypto'
import { link, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArchiveRecord } from '../domain/model.js'
import type { ArchiveStore, RecordFilter, Release } from '../ports/archive-store.js'
import { atomicWrite } from './atomic-write.js'

export class StoreLockedError extends Error {
  constructor(holderPid: number) {
    super(`Another tabkeeper sweep (pid ${holderPid}) is running.`)
  }
}

export class FsArchiveStore implements ArchiveStore {
  private readonly recordsDir: string
  private readonly scrollbackDir: string
  private readonly lockPath: string

  constructor(root: string) {
    this.recordsDir = join(root, 'records')
    this.scrollbackDir = join(root, 'scrollback')
    this.lockPath = join(root, 'sweep.lock')
  }

  async save(record: ArchiveRecord, scrollback: ReadonlyMap<string, string>): Promise<void> {
    if (scrollback.size > 0) {
      const dir = join(this.scrollbackDir, record.id)
      await mkdir(dir, { recursive: true })
      for (const [sessionRef, text] of scrollback) await atomicWrite(join(dir, scrollbackFile(sessionRef)), text)
    }
    await this.update(record)
  }

  async update(record: ArchiveRecord): Promise<void> {
    await mkdir(this.recordsDir, { recursive: true })
    await atomicWrite(this.recordPath(record.id), `${JSON.stringify(record, null, 2)}\n`)
  }

  async remove(id: string): Promise<void> {
    await rm(this.recordPath(id), { force: true })
    await rm(join(this.scrollbackDir, id), { recursive: true, force: true })
  }

  async get(id: string): Promise<ArchiveRecord | undefined> {
    if (!isSafeId(id)) return undefined
    const text = await readFile(this.recordPath(id), 'utf8').catch(ignoreMissing)
    return text === undefined ? undefined : (JSON.parse(text) as ArchiveRecord)
  }

  async list(filter: RecordFilter = {}): Promise<readonly ArchiveRecord[]> {
    const names = (await readdir(this.recordsDir).catch(ignoreMissing)) ?? []
    const records = await Promise.all(
      names.filter((n) => n.endsWith('.json')).map((n) => this.get(n.slice(0, -'.json'.length))),
    )
    return records
      .filter((r): r is ArchiveRecord => r !== undefined)
      .filter(
        (r) =>
          (filter.host === undefined || r.host === filter.host) &&
          (filter.status === undefined || r.status === filter.status),
      )
      .sort((a, b) => b.archivedAt - a.archivedAt)
  }

  async scrollback(id: string, sessionRef: string): Promise<string | undefined> {
    if (!isSafeId(id)) return undefined
    return readFile(join(this.scrollbackDir, id, scrollbackFile(sessionRef)), 'utf8').catch(ignoreMissing)
  }

  /**
   * Published with link(2) so the file always holds its owner's pid. A stale lock is removed only
   * if it still names the same dead pid, so two recovering processes cannot both win.
   */
  async lock(): Promise<Release> {
    await mkdir(join(this.lockPath, '..'), { recursive: true })
    const candidate = `${this.lockPath}.${process.pid}`
    await writeFile(candidate, String(process.pid))
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await link(candidate, this.lockPath)
          return () => rm(this.lockPath, { force: true })
        } catch (error) {
          if (!isErrno(error, 'EEXIST')) throw error
          const holder = await readPid(this.lockPath)
          if (holder === undefined) continue
          if (isAlive(holder)) throw new StoreLockedError(holder)
          if ((await readPid(this.lockPath)) === holder) await rm(this.lockPath, { force: true })
        }
      }
      throw new Error(`Could not acquire ${this.lockPath}.`)
    } finally {
      await rm(candidate, { force: true })
    }
  }

  private recordPath(id: string): string {
    return join(this.recordsDir, `${id}.json`)
  }
}

function scrollbackFile(sessionRef: string): string {
  return `${createHash('sha1').update(sessionRef).digest('hex').slice(0, 16)}.log`
}

function isSafeId(id: string): boolean {
  return /^[\w-]+$/.test(id)
}

async function readPid(path: string): Promise<number | undefined> {
  const pid = Number(await readFile(path, 'utf8').catch(() => ''))
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isErrno(error, 'EPERM')
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

function ignoreMissing(error: unknown): undefined {
  if (isErrno(error, 'ENOENT')) return undefined
  throw error
}
