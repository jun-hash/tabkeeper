import type { Command } from '../command.js'
import { printJson, UsageError } from '../command.js'
import { renderRecord } from '../render.js'

export const restoreCommand: Command = {
  name: 'restore',
  summary: 'Bring an archived session or workspace back',
  usage: 'tabkeeper restore <id> [--json]',
  options: {},
  async run(context) {
    const [query] = context.positionals
    if (!query) throw new UsageError('restore needs an archive id (see `tabkeeper list`)')
    const app = await context.app()
    const record = await app.restore.run(query)
    if (context.json) printJson(context, record)
    else context.print(`Restored.\n${renderRecord(record, Date.now())}`)
    return 0
  },
}
