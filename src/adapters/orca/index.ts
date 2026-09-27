import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AdapterFactory } from '../../ports/host-plugin.js'
import { OrcaAdapter } from './orca-adapter.js'
import { OrcaCli } from './orca-cli.js'
import { OrcaRuntime } from './orca-runtime.js'

export const createOrcaAdapter: AdapterFactory = (options, { runner, env }) => {
  const userDataDir = env.ORCA_USER_DATA_PATH ?? orcaUserDataDir(env)
  return new OrcaAdapter(
    new OrcaCli(runner, options.bin ?? 'orca'),
    new OrcaRuntime(userDataDir),
    join(userDataDir, 'agent-hooks', 'last-status.json'),
  )
}

function orcaUserDataDir(env: Readonly<Record<string, string | undefined>>): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'orca')
    case 'win32':
      return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'orca')
    default:
      return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'orca')
  }
}
