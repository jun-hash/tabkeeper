import type { Command } from '../command.js'
import { printJson } from '../command.js'
import { renderPurge } from '../render.js'

export const purgeCommand: Command = {
  name: 'purge',
  summary: 'Delete checkouts of long-archived workspaces (only clean, pushed ones)',
  usage: 'tabkeeper purge [--dry-run] [--json]',
  options: {
    'dry-run': { type: 'boolean', short: 'n' },
  },
  async run(context) {
    const app = await context.app()
    const outcomes = await app.purge.run({ afterMs: app.config.purge.afterMs, dryRun: context.values['dry-run'] === true })
    if (context.json) printJson(context, outcomes)
    else context.print(renderPurge(outcomes))
    return outcomes.some((o) => o.result === 'failed') ? 1 : 0
  },
}
