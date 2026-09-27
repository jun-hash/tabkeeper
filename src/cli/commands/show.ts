import { resolveRecord } from '../../app/records.js'
import type { Command } from '../command.js'
import { printJson, UsageError } from '../command.js'
import { renderRecord } from '../render.js'

export const showCommand: Command = {
  name: 'show',
  summary: 'Show one archive, optionally with its saved scrollback',
  usage: 'tabkeeper show <id> [--scrollback] [--json]',
  options: {
    scrollback: { type: 'boolean', short: 's' },
  },
  async run(context) {
    const [query] = context.positionals
    if (!query) throw new UsageError('show needs an archive id')
    const app = await context.app()
    const record = await resolveRecord(app.store, query)

    const scrollback = context.flag('scrollback')
      ? await Promise.all(
          record.sessions.map(async (s) => ({
            session: s.title,
            text: (await app.store.scrollback(record.id, s.ref)) ?? '',
          })),
        )
      : []

    if (context.json) {
      printJson(context, { record, scrollback })
      return 0
    }
    context.print(renderRecord(record, Date.now()))
    for (const { session, text } of scrollback) {
      context.print(`\n──── ${session} ────\n${text || '(empty)'}`)
    }
    return 0
  },
}
