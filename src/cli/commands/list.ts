import type { Command } from '../command.js'
import { printJson } from '../command.js'
import { renderRecords } from '../render.js'

export const listCommand: Command = {
  name: 'list',
  summary: 'List archived sessions and workspaces',
  usage: 'tabkeeper list [--all] [--host <id>] [--json]',
  options: {
    all: { type: 'boolean', short: 'a' },
    host: { type: 'string' },
  },
  async run(context) {
    const app = await context.app()
    const host = context.option('host')
    const records = await app.store.list({
      ...(host !== undefined && { host }),
      ...(!context.flag('all') && { status: 'archived' as const }),
    })
    if (context.json) printJson(context, records)
    else context.print(renderRecords(records, Date.now()))
    return 0
  },
}
