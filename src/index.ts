export type {
  AgentSession,
  ArchiveKind,
  ArchiveMode,
  ArchiveRecord,
  ArchiveStatus,
  HostId,
  SessionSnapshot,
  SessionState,
  WorkspaceSnapshot,
  WorkspaceState,
} from './domain/model.js'
export { plan, type Action, type Kept, type Plan, type Policy, type Protection } from './domain/policy.js'

export type { ActivityLedger, Observation } from './ports/activity-ledger.js'
export type { AgentLocator } from './ports/agent-locator.js'
export type { ArchiveStore, RecordFilter, Release } from './ports/archive-store.js'
export type { CommandResult, CommandRunner, RunOptions } from './ports/command-runner.js'
export { PartialArchiveError, type Availability, type HostAdapter, type SessionSpec } from './ports/host-adapter.js'
export type { AdapterContext, AdapterFactory, HostOptions, HostPlugin } from './ports/host-plugin.js'
export type { WorkspaceGuard } from './ports/workspace-guard.js'

export { SweepService, type ActionFailure, type HostReport, type SweepDeps, type SweepOptions } from './app/sweep.js'
export { RestoreError, RestoreService, type RestoreDeps } from './app/restore.js'
export { PurgeService, type PurgeDeps, type PurgeOptions, type PurgeOutcome } from './app/purge.js'
export { AmbiguousRecordError, RecordNotFoundError, resolveRecord } from './app/records.js'
export { SessionCapturer } from './app/session-capturer.js'
export { ObservedActivity } from './app/observed-activity.js'
export { timeSortableId, type IdFactory } from './app/ids.js'

export { ConfigError, loadConfig, parseConfig, toPolicy, type Config, type HostConfig } from './config/config.js'
export { configFile, dataDir } from './config/paths.js'
export { BUILTIN_HOSTS } from './hosts/builtin.js'
export { loadAdapters, UnknownHostError } from './hosts/registry.js'

export { CommandError, execRunner, runChecked } from './infra/command-runner.js'
export { FsArchiveStore, StoreLockedError } from './infra/fs-archive-store.js'
export { FsActivityLedger } from './infra/fs-activity-ledger.js'
export { ClaudeCodeLocator } from './infra/claude-code-locator.js'
export { GitWorkspaceGuard } from './infra/git-workspace-guard.js'
export { agentSession } from './shared/agent-resume.js'
export { createApp, type App, type AppOptions } from './cli/app.js'
