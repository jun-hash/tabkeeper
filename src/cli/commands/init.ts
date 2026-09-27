import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_CONFIG_JSON } from '../../config/config.js'
import { configFile } from '../../config/paths.js'
import type { Command } from '../command.js'

export const initCommand: Command = {
  name: 'init',
  summary: 'Write a default config file',
  usage: 'tabkeeper init [--force]',
  options: {
    force: { type: 'boolean', short: 'f' },
  },
  async run(context) {
    const path = context.option('config') ?? configFile()
    await mkdir(dirname(path), { recursive: true })
    try {
      await writeFile(path, `${JSON.stringify(DEFAULT_CONFIG_JSON, null, 2)}\n`, {
        flag: context.flag('force') ? 'w' : 'wx',
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      context.print(`${path} already exists (use --force to overwrite).`)
      return 1
    }
    context.print(`Wrote ${path}`)
    return 0
  },
}
