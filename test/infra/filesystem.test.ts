import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import type { ArchiveRecord } from '../../src/domain/model.js'
import { ClaudeCodeLocator } from '../../src/infra/claude-code-locator.js'
import { FsActivityLedger } from '../../src/infra/fs-activity-ledger.js'
import { FsArchiveStore, StoreLockedError } from '../../src/infra/fs-archive-store.js'
import { NOW, session } from '../support/builders.js'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tabkeeper-'))
})

const record = (id: string, archivedAt: number, host = 'orca'): ArchiveRecord => ({
  id,
  host,
  kind: 'session',
  mode: 'closed',
  archivedAt,
  reason: 'idle',
  workspace: { ref: 'w', title: 'W' },
  sessions: [{ ref: 'term_1,term_2', title: 't', hasScrollback: true }],
  status: 'archived',
})

describe('FsArchiveStore', () => {
  it('round-trips records and scrollback, newest first', async () => {
    const store = new FsArchiveStore(root)
    await store.save(record('a', 1), new Map([['term_1,term_2', 'hello']]))
    await store.save(record('b', 2, 'cmux'), new Map())

    expect((await store.list()).map((r) => r.id)).toEqual(['b', 'a'])
    expect((await store.list({ host: 'orca' })).map((r) => r.id)).toEqual(['a'])
    expect(await store.scrollback('a', 'term_1,term_2')).toBe('hello')

    await store.remove('a')
    expect(await store.get('a')).toBeUndefined()
    expect(await store.scrollback('a', 'term_1,term_2')).toBeUndefined()
  })

  it('treats path-like ids as missing', async () => {
    expect(await new FsArchiveStore(root).get('../../etc/passwd')).toBeUndefined()
  })

  it('holds an exclusive lock and recovers one left by a dead process', async () => {
    const store = new FsArchiveStore(root)
    const release = await store.lock()
    await expect(store.lock()).rejects.toBeInstanceOf(StoreLockedError)
    await release()

    await writeFile(join(root, 'sweep.lock'), '999999')
    const again = await store.lock()
    await expect(readFile(join(root, 'sweep.lock'), 'utf8')).resolves.toBe(String(process.pid))
    await again()
  })
})

describe('FsActivityLedger', () => {
  it('persists observations per host', async () => {
    const ledger = new FsActivityLedger(join(root, 'activity'))
    await ledger.write('cmux', new Map([['s', { fingerprint: 'f', since: 1 }]]))

    expect(await ledger.read('cmux')).toEqual(new Map([['s', { fingerprint: 'f', since: 1 }]]))
    expect(await ledger.read('orca')).toEqual(new Map())
  })
})

describe('ClaudeCodeLocator', () => {
  async function transcript(cwd: string, id: string, mtime: number) {
    const dir = join(root, cwd.replace(/[^a-zA-Z0-9]/g, '-'))
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${id}.jsonl`)
    await writeFile(file, '{}\n')
    await utimes(file, mtime / 1000, mtime / 1000)
  }

  it('matches the only transcript written around the last output', async () => {
    await transcript('/work/app', 'right', NOW - 30_000)
    await transcript('/work/app', 'stale', NOW - 3_600_000)

    const found = await new ClaudeCodeLocator(root).locate(session({ ref: 's', cwd: '/work/app', lastActivityAt: NOW }))

    expect(found).toEqual({ tool: 'claude', sessionId: 'right', resumeCommand: 'claude --resume right' })
  })

  it('gives up when two transcripts are equally plausible', async () => {
    await transcript('/work/app', 'one', NOW - 10_000)
    await transcript('/work/app', 'two', NOW - 20_000)

    expect(await new ClaudeCodeLocator(root).locate(session({ ref: 's', cwd: '/work/app' }))).toBeUndefined()
  })
})
