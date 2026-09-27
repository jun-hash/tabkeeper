import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { configFile, dataDir } from '../../config/paths.js'
import { execRunner } from '../../infra/command-runner.js'
import { parseDuration } from '../../shared/duration.js'
import type { Command } from '../command.js'
import { UsageError } from '../command.js'
import { cronLine, launchdPlist, sweepInvocation } from '../schedule-files.js'

const LABEL = 'dev.tabkeeper.sweep'

export const scheduleCommand: Command = {
  name: 'schedule',
  summary: 'Run `sweep` periodically (launchd on macOS, prints a cron line elsewhere)',
  usage: 'tabkeeper schedule <install|uninstall> [--every 15m]',
  options: {
    every: { type: 'string' },
  },
  async run(context) {
    const [action] = context.positionals
    if (action !== 'install' && action !== 'uninstall') throw new UsageError('schedule needs "install" or "uninstall"')

    const everyMs = parseDuration(typeof context.values.every === 'string' ? context.values.every : '15m')
    const config = resolve(typeof context.values.config === 'string' ? context.values.config : configFile())
    const invocation = sweepInvocation(process.execPath, resolve(process.argv[1] ?? 'tabkeeper'), config, process.env)
    const logFile = join(dataDir(), 'sweep.log')

    if (process.platform !== 'darwin') {
      context.print(
        action === 'install'
          ? `Add this line with \`crontab -e\`:\n${cronLine(invocation, everyMs, logFile)}`
          : 'Remove the tabkeeper line with `crontab -e`.',
      )
      return 0
    }

    const agentsDir = join(homedir(), 'Library', 'LaunchAgents')
    const plist = join(agentsDir, `${LABEL}.plist`)
    const domain = `gui/${process.getuid?.() ?? 501}`
    await execRunner('launchctl', ['bootout', domain, plist])

    if (action === 'uninstall') {
      await rm(plist, { force: true })
      context.print(`Removed ${plist}`)
      return 0
    }

    await mkdir(dataDir(), { recursive: true })
    await mkdir(agentsDir, { recursive: true })
    await writeFile(plist, launchdPlist(LABEL, invocation, everyMs, logFile))
    const loaded = await execRunner('launchctl', ['bootstrap', domain, plist])
    if (loaded.exitCode !== 0) throw new Error(`launchctl bootstrap failed: ${loaded.stderr.trim()}`)
    context.print(`Sweeping every ${context.values.every ?? '15m'} via ${plist}\nLogs: ${logFile}`)
    return 0
  },
}
