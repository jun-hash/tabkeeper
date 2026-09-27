import { describe, expect, it } from 'vitest'
import { ConfigError, parseConfig, toPolicy } from '../../src/config/config.js'
import { formatDuration, parseDuration } from '../../src/shared/duration.js'

describe('parseDuration', () => {
  it.each([
    ['30m', 1_800_000],
    ['12h', 43_200_000],
    ['1d12h', 129_600_000],
    ['1.5h', 5_400_000],
  ])('parses %s', (input, ms) => expect(parseDuration(input)).toBe(ms))

  it.each(['', '12', 'h', '12x', '1d junk'])('rejects %j', (input) => expect(() => parseDuration(input)).toThrow())

  it('formats with up to two units', () => {
    expect([0, 45_000, 90 * 60_000, 30 * 3_600_000, 8 * 86_400_000].map(formatDuration)).toEqual(['0s', '45s', '1h30m', '1d6h', '8d'])
  })
})

describe('parseConfig', () => {
  it('fills defaults', () => {
    const config = parseConfig({}, 'test')
    expect(config).toMatchObject({
      sessionIdleMs: 12 * 3_600_000,
      workspaceIdleMs: 7 * 86_400_000,
      purge: { enabled: false },
      hosts: { orca: { enabled: true }, cmux: { enabled: true } },
    })
  })

  it('reads overrides and builds a policy', () => {
    const config = parseConfig(
      {
        sessionIdle: '2h',
        workspaceIdle: '3d',
        protect: { paths: ['~/keep'], titles: ['^npm run'] },
        hosts: { orca: { enabled: false, bin: '/opt/orca' }, tmux: { socket: 'work' } },
      },
      'test',
    )
    const policy = toPolicy(config)

    expect(config.hosts).toEqual({
      orca: { enabled: false, bin: '/opt/orca', settings: {} },
      cmux: { enabled: true, settings: {} },
      tmux: { enabled: true, settings: { socket: 'work' } },
    })
    expect(policy.protectedPaths[0]).toMatch(/\/keep$/)
    expect(policy.protectedPaths[0]).not.toContain('~')
    expect(policy.protectedTitles[0]?.test('NPM RUN dev')).toBe(true)
  })

  it.each([
    [{ sessionIdle: 5 }, 'sessionIdle'],
    [{ sessionIdle: '2d', workspaceIdle: '1d' }, 'workspaceIdle'],
    [{ protect: { titles: ['('] } }, 'protect.titles'],
    [{ hosts: { orca: { enabled: 'yes' } } }, 'hosts.orca.enabled'],
    [[], 'config'],
  ])('explains invalid input %j', (raw, key) => {
    expect(() => parseConfig(raw, 'cfg.json')).toThrow(ConfigError)
    expect(() => parseConfig(raw, 'cfg.json')).toThrow(key)
  })
})
