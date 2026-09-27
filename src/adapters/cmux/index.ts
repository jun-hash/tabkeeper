import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AdapterFactory } from '../../ports/host-plugin.js'
import { CmuxAdapter } from './cmux-adapter.js'
import { CmuxCli } from './cmux-cli.js'

const MAC_APP_BIN = '/Applications/cmux.app/Contents/Resources/bin/cmux'

export const createCmuxAdapter: AdapterFactory = (options, { runner, env }) => {
  const bin = options.bin ?? (process.platform === 'darwin' && existsSync(MAC_APP_BIN) ? MAC_APP_BIN : 'cmux')
  const stateDir = env.CMUX_STATE_DIR ?? join(homedir(), '.cmuxterm')
  return new CmuxAdapter(new CmuxCli(runner, bin), join(stateDir, 'events.jsonl'))
}
