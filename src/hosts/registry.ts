import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Config, HostConfig } from '../config/config.js'
import type { HostAdapter } from '../ports/host-adapter.js'
import type { AdapterContext, AdapterFactory, HostPlugin } from '../ports/host-plugin.js'

export class UnknownHostError extends Error {
  constructor(id: string, known: readonly string[]) {
    super(`Unknown host "${id}". Known hosts: ${known.join(', ')}. Add a plugin to support it.`)
  }
}

export async function loadAdapters(
  config: Config,
  context: AdapterContext,
  builtins: ReadonlyMap<string, AdapterFactory>,
  pluginBaseDir: string,
): Promise<HostAdapter[]> {
  const factories = new Map(builtins)
  const hosts = new Map<string, HostConfig>(Object.entries(config.hosts))

  for (const specifier of config.plugins) {
    const plugin = await importPlugin(specifier, pluginBaseDir)
    factories.set(plugin.id, plugin.createAdapter)
    if (!hosts.has(plugin.id)) hosts.set(plugin.id, { enabled: true, settings: {} })
  }

  return [...hosts]
    .filter(([, options]) => options.enabled)
    .map(([id, options]) => {
      const factory = factories.get(id)
      if (!factory) throw new UnknownHostError(id, [...factories.keys()])
      return factory(options, context)
    })
}

async function importPlugin(specifier: string, baseDir: string): Promise<HostPlugin> {
  const isPath = specifier.startsWith('.') || isAbsolute(specifier)
  const target = isPath ? pathToFileURL(resolve(baseDir, specifier)).href : specifier
  const module = (await import(target)) as Partial<HostPlugin> & { default?: Partial<HostPlugin> }
  const plugin = module.createAdapter ? module : module.default
  if (typeof plugin?.id !== 'string' || typeof plugin.createAdapter !== 'function') {
    throw new Error(`Plugin "${specifier}" must export \`id\` and \`createAdapter\`.`)
  }
  return plugin as HostPlugin
}
