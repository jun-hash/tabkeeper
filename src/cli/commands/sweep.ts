import type { Command } from '../command.js'
import { printJson } from '../command.js'
import { renderPurge, renderSweep } from '../render.js'

export const sweepCommand: Command = {
  name: 'sweep',
  summary: 'Archive idle sessions and workspaces (run this on a schedule)',
  usage: 'tabkeeper sweep [--dry-run] [--host <id>] [--verbose] [--json]',
  options: {
    'dry-run': { type: 'boolean', short: 'n' },
    host: { type: 'string', multiple: false },
    verbose: { type: 'boolean', short: 'v' },
  },
  async run(context) {
    const dryRun = context.values['dry-run'] === true
    const host = context.values.host
    const app = await context.app(typeof host === 'string' ? { hosts: [host] } : {})

    const reports = await app.sweep.run({ dryRun })
    const purged = app.config.purge.enabled ? await app.purge.run({ afterMs: app.config.purge.afterMs, dryRun }) : []

    if (context.json) printJson(context, { reports, purged })
    else {
      context.print(renderSweep(reports, dryRun, context.values.verbose === true))
      if (app.config.purge.enabled) context.print(`\npurge:\n${renderPurge(purged)}`)
    }
    const failed = reports.some((r) => r.status === 'failed' || (r.status === 'ok' && r.failures.length > 0))
    return failed ? 1 : 0
  },
}
