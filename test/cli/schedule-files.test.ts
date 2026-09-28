import { describe, expect, it } from 'bun:test'
import { cronLine, launchdPlist, sweepInvocation } from '../../src/cli/schedule-files.js'

const invocation = sweepInvocation(['/bin/node', '/opt/tk/main.js'], '/cfg/it is.json', {
  PATH: '/usr/bin',
  TABKEEPER_HOME: '/data',
  SECRET_TOKEN: 'nope',
})

describe('schedule files', () => {
  it('carries the config path and only the relevant environment', () => {
    expect(invocation).toEqual({
      argv: ['/bin/node', '/opt/tk/main.js', 'sweep', '--config', '/cfg/it is.json'],
      env: { PATH: '/usr/bin', TABKEEPER_HOME: '/data' },
    })
  })

  it.each([
    [15 * 60_000, '*/15 * * * *'],
    [2 * 3_600_000, '0 */2 * * *'],
    [2 * 86_400_000, '0 0 * * *'],
  ])('builds a valid cron schedule for %i ms', (every, schedule) => {
    expect(cronLine(invocation, every, '/data/sweep.log')).toBe(
      `${schedule} PATH=/usr/bin TABKEEPER_HOME=/data /bin/node /opt/tk/main.js sweep --config '/cfg/it is.json' >> /data/sweep.log 2>&1`,
    )
  })

  it('writes a launchd job with the same invocation', () => {
    const plist = launchdPlist('dev.tabkeeper.sweep', invocation, 15 * 60_000, '/data/sweep.log')
    expect(plist).toContain('<string>/cfg/it is.json</string>')
    expect(plist).toContain('<key>TABKEEPER_HOME</key>')
    expect(plist).toContain('<integer>900</integer>')
    expect(plist).not.toContain('SECRET_TOKEN')
  })
})
