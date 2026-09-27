import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { timeSortableId } from '../app/ids.js'
import { ObservedActivity } from '../app/observed-activity.js'
import { PurgeService } from '../app/purge.js'
import { RestoreService } from '../app/restore.js'
import { SessionCapturer } from '../app/session-capturer.js'
import { SweepService } from '../app/sweep.js'
import { loadConfig, toPolicy, type Config } from '../config/config.js'
import { configFile, dataDir } from '../config/paths.js'
import { BUILTIN_HOSTS } from '../hosts/builtin.js'
import { loadAdapters } from '../hosts/registry.js'
import { ClaudeCodeLocator } from '../infra/claude-code-locator.js'
import { execRunner } from '../infra/command-runner.js'
import { FsActivityLedger } from '../infra/fs-activity-ledger.js'
import { FsArchiveStore } from '../infra/fs-archive-store.js'
import { GitWorkspaceGuard } from '../infra/git-workspace-guard.js'
import type { ArchiveStore } from '../ports/archive-store.js'
import type { HostAdapter } from '../ports/host-adapter.js'

export interface App {
  readonly config: Config
  readonly configPath: string
  readonly dataDir: string
  readonly store: ArchiveStore
  readonly adapters: readonly HostAdapter[]
  readonly sweep: SweepService
  readonly restore: RestoreService
  readonly purge: PurgeService
}

export interface AppOptions {
  readonly configPath?: string
  readonly hosts?: readonly string[]
}

export async function createApp(options: AppOptions = {}): Promise<App> {
  const env = process.env
  const configPath = options.configPath ?? configFile(env)
  const config = await loadConfig(configPath)
  const root = dataDir(env)
  const clock = () => Date.now()

  const loaded = await loadAdapters(config, { runner: execRunner, env }, BUILTIN_HOSTS, dirname(configPath))
  const adapters = options.hosts ? loaded.filter((a) => options.hosts?.includes(a.id)) : loaded
  const byId = new Map(adapters.map((a) => [a.id, a]))
  const store = new FsArchiveStore(root)
  const capturer = new SessionCapturer(
    [new ClaudeCodeLocator(join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects'))],
    config.scrollbackLines,
  )

  return {
    config,
    configPath,
    dataDir: root,
    store,
    adapters,
    sweep: new SweepService({
      adapters,
      store,
      capturer,
      activity: new ObservedActivity(new FsActivityLedger(join(root, 'activity')), clock),
      policy: toPolicy(config),
      clock,
      newId: timeSortableId,
    }),
    restore: new RestoreService({ adapters: byId, store, clock }),
    purge: new PurgeService({ adapters: byId, store, guard: new GitWorkspaceGuard(execRunner), clock }),
  }
}
