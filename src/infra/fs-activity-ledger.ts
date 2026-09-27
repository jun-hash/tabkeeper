import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ActivityLedger, Observation } from '../ports/activity-ledger.js'
import { atomicWrite } from './atomic-write.js'

export class FsActivityLedger implements ActivityLedger {
  constructor(private readonly dir: string) {}

  async read(host: string): Promise<ReadonlyMap<string, Observation>> {
    try {
      const entries = JSON.parse(await readFile(this.file(host), 'utf8')) as Record<string, Observation>
      return new Map(Object.entries(entries))
    } catch {
      return new Map()
    }
  }

  async write(host: string, observations: ReadonlyMap<string, Observation>): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await atomicWrite(this.file(host), `${JSON.stringify(Object.fromEntries(observations), null, 2)}\n`)
  }

  private file(host: string): string {
    return join(this.dir, `${host.replace(/[^\w-]/g, '_')}.json`)
  }
}
