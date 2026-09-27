import type { Command } from '../command.js'
import { printJson } from '../command.js'

export const doctorCommand: Command = {
  name: 'doctor',
  summary: 'Check the config and whether each host is reachable',
  usage: 'tabkeeper doctor [--json]',
  options: {},
  async run(context) {
    const app = await context.app()
    const hosts = await Promise.all(app.adapters.map(async (a) => ({ host: a.id, ...(await a.probe()) })))
    if (context.json) {
      printJson(context, { config: app.configPath, data: app.dataDir, hosts })
    } else {
      context.print(`config  ${app.configPath}\ndata    ${app.dataDir}`)
      for (const h of hosts) context.print(`${h.available ? '✓' : '✗'} ${h.host}${h.available ? '' : `  ${h.reason}`}`)
    }
    return hosts.every((h) => h.available) ? 0 : 1
  },
}
