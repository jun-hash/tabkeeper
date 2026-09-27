import { createCmuxAdapter } from '../adapters/cmux/index.js'
import { createOrcaAdapter } from '../adapters/orca/index.js'
import type { AdapterFactory } from '../ports/host-plugin.js'

export const BUILTIN_HOSTS: ReadonlyMap<string, AdapterFactory> = new Map([
  ['orca', createOrcaAdapter],
  ['cmux', createCmuxAdapter],
])
