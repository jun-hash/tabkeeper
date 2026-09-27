#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { messageOf } from '../shared/errors.js'
import { createApp } from './app.js'
import { UsageError, type Command, type OptionSpec } from './command.js'
import { doctorCommand } from './commands/doctor.js'
import { initCommand } from './commands/init.js'
import { listCommand } from './commands/list.js'
import { purgeCommand } from './commands/purge.js'
import { restoreCommand } from './commands/restore.js'
import { scheduleCommand } from './commands/schedule.js'
import { showCommand } from './commands/show.js'
import { sweepCommand } from './commands/sweep.js'

const COMMANDS: readonly Command[] = [
  sweepCommand,
  listCommand,
  showCommand,
  restoreCommand,
  purgeCommand,
  doctorCommand,
  initCommand,
  scheduleCommand,
]

const GLOBAL_OPTIONS: OptionSpec = {
  config: { type: 'string', short: 'c' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
}

export async function main(argv: readonly string[]): Promise<number> {
  const [name, ...rest] = argv
  const command = COMMANDS.find((c) => c.name === name)
  if (!command) {
    const unknown = name && !name.startsWith('-')
    ;(unknown ? process.stderr : process.stdout).write(`${unknown ? `Unknown command "${name}".\n\n` : ''}${help()}\n`)
    return unknown ? 2 : 0
  }

  try {
    const { values, positionals } = parseArgs({
      args: [...rest],
      options: { ...GLOBAL_OPTIONS, ...command.options },
      allowPositionals: true,
    })
    if (values.help) {
      process.stdout.write(`${command.summary}\n\nUsage: ${command.usage}\n`)
      return 0
    }
    const configPath = typeof values.config === 'string' ? values.config : undefined
    return await command.run({
      values: values as Record<string, string | boolean | undefined>,
      positionals,
      json: values.json === true,
      app: (overrides = {}) => createApp({ ...overrides, ...(configPath !== undefined && { configPath }) }),
      print: (text) => process.stdout.write(`${text}\n`),
    })
  } catch (error) {
    process.stderr.write(`tabkeeper ${command.name}: ${messageOf(error)}\n`)
    if (error instanceof UsageError || isParseError(error)) {
      process.stderr.write(`Usage: ${command.usage}\n`)
      return 2
    }
    return 1
  }
}

function help(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length))
  const lines = COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`)
  return [
    'tabkeeper — Arc-style auto-archiving for idle agent terminals.',
    '',
    'Usage: tabkeeper <command> [--config <path>] [--json]',
    '',
    'Commands:',
    ...lines,
    '',
    'Run `tabkeeper <command> --help` for details.',
  ].join('\n')
}

function isParseError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS')
}

process.exitCode = await main(process.argv.slice(2))
