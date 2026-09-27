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

/** Shape a plugin module must export to add a host (`plugins: ["tabkeeper-zellij"]` in the config). */
export interface HostPlugin {
  readonly id: string
  readonly createAdapter: AdapterFactory
}
