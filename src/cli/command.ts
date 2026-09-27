import type { ParseArgsConfig } from 'node:util'
import type { App, AppOptions } from './app.js'

export type OptionSpec = NonNullable<ParseArgsConfig['options']>

export interface CommandContext {
  readonly flag: (name: string) => boolean
  readonly option: (name: string) => string | undefined
  readonly positionals: readonly string[]
  readonly json: boolean
  readonly app: (overrides?: Pick<AppOptions, 'hosts'>) => Promise<App>
  readonly print: (text: string) => void
}

export interface Command {
  readonly name: string
  readonly summary: string
  readonly usage: string
  readonly options: OptionSpec
  run(context: CommandContext): Promise<number>
}

export class UsageError extends Error {}

export function printJson(context: CommandContext, value: unknown): void {
  context.print(JSON.stringify(value, null, 2))
}
