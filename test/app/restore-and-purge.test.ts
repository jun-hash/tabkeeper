import { describe, expect, it } from 'vitest'
import { PurgeService } from '../../src/app/purge.js'
import { AmbiguousRecordError, RecordNotFoundError } from '../../src/app/records.js'
import { RestoreError, RestoreService } from '../../src/app/restore.js'
import type { ArchiveRecord } from '../../src/domain/model.js'
import { DAY, NOW, workspace } from '../support/builders.js'
import { FakeAdapter, MemoryStore } from '../support/fakes.js'

function record(overrides: Partial<ArchiveRecord> & { id: string }): ArchiveRecord {
  return {
    host: 'fake',
    kind: 'session',
    mode: 'closed',
    archivedAt: NOW - DAY,
    reason: 'idle',
    workspace: { ref: 'w', title: 'Work', path: '/work' },
    sessions: [
      {
        ref: 's',
        title: 'agent',
        cwd: '/work',
        hasScrollback: false,
        agent: { tool: 'claude', sessionId: 'abc', resumeCommand: 'claude --resume abc' },
      },
      { ref: 'b', title: 'docs', url: 'https://example.com', hasScrollback: false },
    ],
    status: 'archived',
    ...overrides,
  }
}

async function seeded(...records: ArchiveRecord[]) {
  const store = new MemoryStore()
  for (const r of records) await store.update(r)
  return store
}

describe('RestoreService', () => {
  it('reopens closed sessions with their resume command or url, then marks the record restored', async () => {
    const adapter = new FakeAdapter('fake')
    const store = await seeded(record({ id: 'm1-aaaa' }))
    const service = new RestoreService({ adapters: new Map([['fake', adapter]]), store, clock: () => NOW })

    const restored = await service.run('m1')

    expect(adapter.restored).toEqual([
      {
        snapshot: { ref: 'w', title: 'Work', path: '/work' },
        sessions: [
          { title: 'agent', cwd: '/work', command: 'claude --resume abc' },
          { title: 'docs', url: 'https://example.com' },
        ],
      },
    ])
    expect(restored).toMatchObject({ status: 'restored', restoredAt: NOW })
    expect((await store.get('m1-aaaa'))?.status).toBe('restored')
  })

  it('lets the host resume a natively archived workspace by itself', async () => {
    const adapter = new FakeAdapter('fake')
    const store = await seeded(record({ id: 'r1', kind: 'workspace', mode: 'native' }))
    await new RestoreService({ adapters: new Map([['fake', adapter]]), store, clock: () => NOW }).run('r1')

    expect(adapter.restored[0]?.sessions).toEqual([])
  })

  it.each([
    ['already restored', record({ id: 'r1', status: 'restored' }), 'fake', RestoreError],
    ['from a disabled host', record({ id: 'r1', host: 'other' }), 'fake', RestoreError],
  ])('refuses to restore an archive %s', async (_, rec, host, error) => {
    const service = new RestoreService({
      adapters: new Map([[host, new FakeAdapter(host)]]),
      store: await seeded(rec),
      clock: () => NOW,
    })
    await expect(service.run('r1')).rejects.toBeInstanceOf(error)
  })

  it('rejects unknown and ambiguous id prefixes', async () => {
    const store = await seeded(record({ id: 'ab-1' }), record({ id: 'ab-2' }))
    const service = new RestoreService({ adapters: new Map(), store, clock: () => NOW })

    await expect(service.run('zz')).rejects.toBeInstanceOf(RecordNotFoundError)
    await expect(service.run('ab')).rejects.toBeInstanceOf(AmbiguousRecordError)
  })
})

describe('PurgeService', () => {
  const old = record({ id: 'old', kind: 'workspace', archivedAt: NOW - 40 * DAY })
  const recent = record({ id: 'recent', kind: 'workspace', archivedAt: NOW - 5 * DAY })

  function setup(risk?: string) {
    const adapter = new FakeAdapter('fake')
    const store = new MemoryStore()
    const service = new PurgeService({
      adapters: new Map([['fake', adapter]]),
      store,
      guard: { riskOf: async () => risk },
      clock: () => NOW,
    })
    return { adapter, store, service }
  }

  it('removes only workspaces archived past the grace period', async () => {
    const { adapter, store, service } = setup()
    await store.update(old)
    await store.update(recent)

    const outcomes = await service.run({ afterMs: 30 * DAY, dryRun: false })

    expect(outcomes.map((o) => [o.record.id, o.result])).toEqual([['old', 'purged']])
    expect(adapter.calls).toEqual(['remove-workspace w'])
    expect((await store.get('old'))?.status).toBe('purged')
  })

  it('skips checkouts that still hold work', async () => {
    const { adapter, store, service } = setup('has unpushed commits')
    await store.update(old)

    const [outcome] = await service.run({ afterMs: 30 * DAY, dryRun: false })

    expect(outcome).toMatchObject({ result: 'skipped', reason: 'has unpushed commits' })
    expect(adapter.calls).toEqual([])
  })

  it('only reports on a dry run', async () => {
    const { adapter, store, service } = setup()
    await store.update(old)

    const [outcome] = await service.run({ afterMs: 30 * DAY, dryRun: true })

    expect(outcome?.result).toBe('would-purge')
    expect(adapter.calls).toEqual([])
  })

  it('skips hosts that cannot remove workspaces', async () => {
    const { adapter, store, service } = setup()
    Object.assign(adapter, { removeWorkspace: undefined })
    await store.update(old)

    expect((await service.run({ afterMs: 30 * DAY, dryRun: false }))[0]?.result).toBe('skipped')
  })

  it('skips a workspace the host shows again', async () => {
    const { adapter, store, service } = setup()
    adapter.workspaces = [workspace({ ref: 'w' })]
    await store.update(old)

    const [outcome] = await service.run({ afterMs: 30 * DAY, dryRun: false })

    expect(outcome).toMatchObject({ result: 'skipped', reason: 'workspace is in use again' })
    expect(adapter.calls).toEqual([])
  })
})
