import type { CommandRunner } from './command-runner.js'
import type { HostAdapter } from './host-adapter.js'

export interface HostOptions {
  readonly bin?: string
  /** Every other key under `hosts.<id>` in the config, untouched. */
  readonly settings: Readonly<Record<string, unknown>>
}

export interface AdapterContext {
  readonly runner: CommandRunner
  readonly env: Readonly<Record<string, string | undefined>>
}

export type AdapterFactory = (options: HostOptions, context: AdapterContext) => HostAdapter

/** What a module listed under `plugins` must export. */
export interface HostPlugin {
  readonly id: string
  readonly createAdapter: AdapterFactory
}
