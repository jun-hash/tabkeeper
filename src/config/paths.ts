import { homedir } from 'node:os'
import { join } from 'node:path'

type Env = Readonly<Record<string, string | undefined>>

export function configFile(env: Env = process.env): string {
  return env.TABKEEPER_CONFIG ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'tabkeeper', 'config.json')
}

export function dataDir(env: Env = process.env): string {
  return env.TABKEEPER_HOME ?? join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'tabkeeper')
}

export function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
}
