import { describe, expect, it } from 'bun:test'
import { ObservedActivity } from '../../src/app/observed-activity.js'
import { SessionCapturer } from '../../src/app/session-capturer.js'
import { SweepService } from '../../src/app/sweep.js'
import type { AgentLocator } from '../../src/ports/agent-locator.js'
import { PartialArchiveError } from '../../src/ports/host-adapter.js'
import type { ActivityLedger, Observation } from '../../src/ports/activity-ledger.js'
import { DAY, HOUR, NOW, policy, session, workspace } from '../support/builders.js'
import { FakeAdapter, MemoryStore } from '../support/fakes.js'

class MemoryLedger implements ActivityLedger {
  readonly data = new Map<string, ReadonlyMap<string, Observation>>()
  async read(host: string) {
    return this.data.get(host) ?? new Map()
  }
  async write(host: string, observations: ReadonlyMap<string, Observation>) {
    this.data.set(host, observations)
  }
}

function setup(adapters: FakeAdapter[], locators: AgentLocator[] = []) {
  const store = new MemoryStore()
  let seq = 0
  const service = new SweepService({
    adapters,
    store,
    capturer: new SessionCapturer(locators, 100),
    activity: new ObservedActivity(new MemoryLedger(), () => NOW),
    policy: policy(),
    clock: () => NOW,
    newId: () => `id${++seq}`,
  })
  return { store, service }
}

describe('SweepService', () => {
  const idleSession = session({ ref: 's-idle', title: 'old shell', cwd: '/work/w', lastActivityAt: NOW - 20 * HOUR })
  const liveSession = session({ ref: 's-live', lastActivityAt: NOW - HOUR })

  it('snapshots then closes idle sessions', async () => {
    const adapter = new FakeAdapter('fake', [workspace({ ref: 'w', sessions: [idleSession, liveSession] })])
    const { store, service } = setup([adapter])

    const [report] = await service.run({ dryRun: false })

    expect(adapter.calls).toEqual(['close-session s-idle'])
    expect(report).toMatchObject({ status: 'ok', archived: [{ id: 'id1', kind: 'session', mode: 'closed' }] })
    expect(await store.get('id1')).toMatchObject({
      reason: 'idle for 20h',
      sessions: [{ ref: 's-idle', title: 'old shell', cwd: '/work/w', hasScrollback: true }],
    })
    expect(await store.scrollback('id1', 's-idle')).toBe('scrollback of s-idle')
    expect(store.locks).toBe(0)
  })

  it('records how the host archived a workspace', async () => {
    const adapter = new FakeAdapter('fake', [
      workspace({ ref: 'w', sessions: [session({ ref: 'a', lastActivityAt: NOW - 8 * DAY })] }),
    ])
    adapter.archiveMode = 'native'
    const { store, service } = setup([adapter])

    await service.run({ dryRun: false })

    expect(adapter.calls).toEqual(['archive-workspace w'])
    expect(await store.get('id1')).toMatchObject({ kind: 'workspace', mode: 'native', sessions: [{ ref: 'a' }] })
  })

  it('attaches the agent conversation found by a locator', async () => {
    const adapter = new FakeAdapter('fake', [workspace({ ref: 'w', sessions: [idleSession, liveSession] })])
    const locator: AgentLocator = {
      locate: async (s) =>
        s.ref === 's-idle' ? { tool: 'claude', sessionId: 'abc', resumeCommand: 'claude --resume abc' } : undefined,
    }
    const { store, service } = setup([adapter], [locator])

    await service.run({ dryRun: false })

    expect((await store.get('id1'))?.sessions[0]?.agent?.resumeCommand).toBe('claude --resume abc')
  })

  it('drops the snapshot when closing the session fails, so nothing claims to be archived', async () => {
    const adapter = new FakeAdapter('fake', [workspace({ ref: 'w', sessions: [idleSession, liveSession] })])
    adapter.failClose = true
    const { store, service } = setup([adapter])

    const [report] = await service.run({ dryRun: false })

    expect(report).toMatchObject({ status: 'ok', archived: [], failures: [{ message: 'close failed' }] })
    expect(store.records.size).toBe(0)
  })

  it('plans without touching anything on a dry run', async () => {
    const adapter = new FakeAdapter('fake', [workspace({ ref: 'w', sessions: [idleSession, liveSession] })])
    const { store, service } = setup([adapter])

    const [report] = await service.run({ dryRun: true })

    expect(report).toMatchObject({ status: 'ok', planned: [{ kind: 'archive-session' }], archived: [] })
    expect(adapter.calls).toEqual([])
    expect(store.records.size).toBe(0)
  })

  it('reports an unreachable host and keeps sweeping the others', async () => {
    const down = new FakeAdapter('down')
    down.availability = { available: false, reason: 'not running' }
    const up = new FakeAdapter('up', [workspace({ ref: 'w', sessions: [idleSession, liveSession] })])
    const { service } = setup([down, up])

    const reports = await service.run({ dryRun: false })

    expect(reports).toMatchObject([
      { host: 'down', status: 'unavailable', reason: 'not running' },
      { host: 'up', status: 'ok' },
    ])
  })

  it('ages fingerprinted sessions from when their content last changed', async () => {
    const ledger = new MemoryLedger()
    ledger.data.set('fake', new Map([['quiet', { fingerprint: 'same', since: NOW - 13 * HOUR }]]))
    const quiet = session({ ref: 'quiet', fingerprint: 'same', lastActivityAt: undefined })
    const loud = session({ ref: 'loud', fingerprint: 'new', lastActivityAt: undefined })
    const adapter = new FakeAdapter('fake', [workspace({ ref: 'w', sessions: [quiet, loud] })])
    const service = new SweepService({
      adapters: [adapter],
      store: new MemoryStore(),
      capturer: new SessionCapturer([], 0),
      activity: new ObservedActivity(ledger, () => NOW),
      policy: policy(),
      clock: () => NOW,
      newId: () => 'id',
    })

    await service.run({ dryRun: false })

    expect(adapter.calls).toEqual(['close-session quiet'])
    expect(ledger.data.get('fake')?.get('loud')).toEqual({ fingerprint: 'new', since: NOW })
  })

  it.each([
    ['drops the record when archiving a workspace fails outright', new Error('timeout'), 0],
    ['keeps the record when some sessions were already closed', new PartialArchiveError('closed 1 of 2'), 1],
  ])('%s', async (_, error, remaining) => {
    const adapter = new FakeAdapter('fake', [
      workspace({ ref: 'w', sessions: [session({ ref: 'a', lastActivityAt: NOW - 8 * DAY })] }),
    ])
    adapter.archiveWorkspace = async () => {
      throw error
    }
    const { store, service } = setup([adapter])

    const [report] = await service.run({ dryRun: false })

    expect(report).toMatchObject({ failures: [{ message: error.message }] })
    expect(store.records.size).toBe(remaining)
  })

  it('does not record observations on a dry run', async () => {
    const ledger = new MemoryLedger()
    const adapter = new FakeAdapter('fake', [
      workspace({ ref: 'w', sessions: [session({ ref: 's', fingerprint: 'f' })] }),
    ])
    const service = new SweepService({
      adapters: [adapter],
      store: new MemoryStore(),
      capturer: new SessionCapturer([], 0),
      activity: new ObservedActivity(ledger, () => NOW),
      policy: policy(),
      clock: () => NOW,
      newId: () => 'id',
    })

    await service.run({ dryRun: true })

    expect(ledger.data.size).toBe(0)
  })
})
