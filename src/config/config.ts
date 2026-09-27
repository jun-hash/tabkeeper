import { readFile } from 'node:fs/promises'
import type { Policy } from '../domain/policy.js'
import type { HostOptions } from '../ports/host-plugin.js'
import { parseDuration } from '../shared/duration.js'
import { expandHome } from './paths.js'

export interface HostConfig extends HostOptions {
  readonly enabled: boolean
}

export interface Config {
  readonly sessionIdleMs: number
  readonly workspaceIdleMs: number
  readonly scrollbackLines: number
  readonly protect: { readonly paths: readonly string[]; readonly titles: readonly string[] }
  readonly purge: { readonly enabled: boolean; readonly afterMs: number }
  readonly hosts: Readonly<Record<string, HostConfig>>
  /** Module specifiers exporting `createAdapter` — how third-party hosts plug in. */
  readonly plugins: readonly string[]
}

export const DEFAULT_CONFIG_JSON = {
  sessionIdle: '12h',
  workspaceIdle: '7d',
  scrollbackLines: 2000,
  protect: { paths: [], titles: [] },
  purge: { enabled: false, after: '30d' },
  hosts: { orca: { enabled: true }, cmux: { enabled: true } },
  plugins: [],
}

export class ConfigError extends Error {
  constructor(source: string, message: string) {
    super(`${source}: ${message}`)
  }
}

export async function loadConfig(path: string): Promise<Config> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return parseConfig(DEFAULT_CONFIG_JSON, 'defaults')
    throw error
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ConfigError(path, `invalid JSON (${(error as Error).message})`)
  }
  return parseConfig(raw, path)
}

export function parseConfig(raw: unknown, source: string): Config {
  const read = new Reader(source)
  const root = read.object(raw, '')
  const defaults = DEFAULT_CONFIG_JSON
  const protect = read.object(root.protect ?? defaults.protect, 'protect')
  const purge = read.object(root.purge ?? defaults.purge, 'purge')
  const hosts = { ...defaults.hosts, ...read.object(root.hosts ?? {}, 'hosts') }

  const config: Config = {
    sessionIdleMs: read.duration(root.sessionIdle ?? defaults.sessionIdle, 'sessionIdle'),
    workspaceIdleMs: read.duration(root.workspaceIdle ?? defaults.workspaceIdle, 'workspaceIdle'),
    scrollbackLines: read.count(root.scrollbackLines ?? defaults.scrollbackLines, 'scrollbackLines'),
    protect: {
      paths: read.strings(protect.paths ?? [], 'protect.paths'),
      titles: read.strings(protect.titles ?? [], 'protect.titles').map((t) => read.pattern(t, 'protect.titles')),
    },
    purge: {
      enabled: read.boolean(purge.enabled ?? false, 'purge.enabled'),
      afterMs: read.duration(purge.after ?? defaults.purge.after, 'purge.after'),
    },
    hosts: Object.fromEntries(
      Object.entries(hosts).map(([id, value]) => {
        const { enabled, bin, ...settings } = read.object(value, `hosts.${id}`)
        const host: HostConfig = {
          enabled: read.boolean(enabled ?? true, `hosts.${id}.enabled`),
          ...(bin !== undefined && { bin: read.string(bin, `hosts.${id}.bin`) }),
          settings,
        }
        return [id, host]
      }),
    ),
    plugins: read.strings(root.plugins ?? [], 'plugins'),
  }

  if (config.workspaceIdleMs < config.sessionIdleMs) {
    throw new ConfigError(source, 'workspaceIdle must be at least as long as sessionIdle')
  }
  return config
}

export function toPolicy(config: Config): Policy {
  return {
    sessionIdleMs: config.sessionIdleMs,
    workspaceIdleMs: config.workspaceIdleMs,
    protectedPaths: config.protect.paths.map(expandHome),
    protectedTitles: config.protect.titles.map((t) => new RegExp(t, 'i')),
  }
}

class Reader {
  constructor(private readonly source: string) {}

  object(value: unknown, key: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) this.fail(key, 'must be an object')
    return value as Record<string, unknown>
  }

  string(value: unknown, key: string): string {
    if (typeof value !== 'string' || value.length === 0) this.fail(key, 'must be a non-empty string')
    return value as string
  }

  strings(value: unknown, key: string): string[] {
    if (!Array.isArray(value)) this.fail(key, 'must be an array of strings')
    return (value as unknown[]).map((item, i) => this.string(item, `${key}[${i}]`))
  }

  boolean(value: unknown, key: string): boolean {
    if (typeof value !== 'boolean') this.fail(key, 'must be true or false')
    return value as boolean
  }

  count(value: unknown, key: string): number {
    if (!Number.isInteger(value) || (value as number) < 0) this.fail(key, 'must be a non-negative integer')
    return value as number
  }

  duration(value: unknown, key: string): number {
    const ms = this.attempt(key, () => parseDuration(this.string(value, key)))
    if (ms <= 0) this.fail(key, 'must be longer than zero')
    return ms
  }

  pattern(value: string, key: string): string {
    this.attempt(key, () => new RegExp(value))
    return value
  }

  private attempt<T>(key: string, fn: () => T): T {
    try {
      return fn()
    } catch (error) {
      if (error instanceof ConfigError) throw error
      return this.fail(key, (error as Error).message)
    }
  }

  private fail(key: string, message: string): never {
    throw new ConfigError(this.source, `${key || 'config'} ${message}`)
  }
}
