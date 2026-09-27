# tabkeeper

**Arc-style auto-archiving for the terminal tabs and workspaces your coding agents leave behind.**

Running a fleet of agents in [Orca](https://github.com/stablyai/orca), [cmux](https://github.com/manaflow-ai/cmux), or tmux leaves you with dozens of tabs nobody has touched in days. tabkeeper does what Arc does for browser tabs: once something has been idle long enough, it snapshots it and closes it. You can restore it later, including resuming the agent conversation that was running in it.

```text
$ tabkeeper sweep --dry-run --verbose
orca: would archive 3, kept 2 protected
  would archive session "Fix flaky login test" in "feat/auth" (idle 14h)
  would archive workspace "bluegill" with 2 session(s) (idle 8d13h)
  would archive workspace "spike/pdf-parser" with 0 session(s) (idle 18d4h)
  kept     workspace "main" — permanent
  kept     session "Refactor billing" in "feat/billing" — busy

$ tabkeeper list
ID             HOST  KIND       STATUS    ARCHIVED  TARGET
mkx2v1a0-7f3c  orca  workspace  archived  2h ago    bluegill (2 session(s))
mkx2v19s-a1d4  orca  session    archived  2h ago    Fix flaky login test @ feat/auth

$ tabkeeper restore mkx2v19s
Restored.
```

## How it works

tabkeeper checks two levels, just like the sidebar you are looking at:

```
workspace   (Orca worktree · cmux workspace · tmux session)
 └─ session (terminal tab · browser tab · tmux window)
```

- **Idle sessions are archived one by one.** A tab that has been quiet for `sessionIdle` (default `12h`) is archived even if the rest of its workspace is busy.
- **Idle workspaces are archived as a whole.** When every session in a workspace has been quiet for `workspaceIdle` (default `7d`), the workspace and everything in it are archived together.
- **Nothing that matters is touched.** The protections below always win. Because archiving a workspace closes every tab in it, a protection on any one tab also keeps the whole workspace.

| Protection | Effect |
| --- | --- |
| `pinned` | Pinned workspaces and all of their sessions are never archived. |
| `protected` | Workspaces or sessions matching `protect.paths` / `protect.titles` are skipped. |
| `busy` | A session with a running agent is kept, and so is its workspace. Orca and cmux detect agents only: a quiet dev server or `ssh` session counts as idle, so list those under `protect.titles`. |
| `focused` | The workspace or tab you are looking at is not archived, when the host reports it. cmux and tmux report the focused tab; Orca reports only the active worktree. |
| `permanent` | A host's permanent workspace (such as a repository's main worktree) is never archived as a whole, though its idle tabs still are. |
| `last-session` | A workspace that is kept is never emptied: its most recent tab survives. |
| `activity-unknown` | If the host cannot say when a tab was last active, the tab is left alone, and so is its workspace. |

### What gets saved

Archiving writes a record before anything is closed. Each record holds:

- the workspace: title, path, branch
- each tab: title, working directory, URL for browser tabs
- the last `scrollbackLines` of terminal output (default `2000`), which you can read with `tabkeeper show <id> --scrollback`
- **the agent conversation**, so that restore reopens the tab with `claude --resume <id>`, `codex resume <id>`, or `opencode --session <id>`

Agent conversations come from the host when it knows them (Orca and cmux both track agent sessions). Otherwise tabkeeper matches Claude Code transcripts under `~/.claude/projects` by working directory and timestamp. If more than one transcript could match, it saves none rather than guess.

### Restoring

`tabkeeper restore <id>` brings a record back. You can type just the start of the id, the way you would with a git commit hash.

- A **closed** archive is reopened from its snapshot: the workspace is created again if it no longer exists, and each tab is reopened with its title, working directory, and resume command.
- A **native** archive was suspended by the host itself (Orca's "sleep"). Restoring it un-hides the workspace, and the host resumes its own sessions.

### Purging (opt-in)

With `purge.enabled`, workspaces that have stayed archived longer than `purge.after` (default `30d`) have their checkout deleted. Deletion only happens when the host supports it, the workspace has not come back into use, and git finds nothing to lose. Any of the following blocks a purge:

- uncommitted changes or untracked files
- stashes
- no upstream branch
- unpushed commits

Files matched by `.gitignore` (such as `.env`, build output, or local databases) do not block a purge and are deleted with the checkout.

`tabkeeper purge --dry-run` shows what would happen without deleting anything.

## Install

```sh
git clone https://github.com/jun-hash/tabkeeper.git && cd tabkeeper
npm install && npm run build && npm link
```

Requires Node.js 20 or newer.

## Quick start

```sh
tabkeeper init                      # writes ~/.config/tabkeeper/config.json
tabkeeper doctor                    # checks which hosts are reachable
tabkeeper sweep --dry-run --verbose # shows what would be archived and why
tabkeeper sweep                     # archives it
tabkeeper schedule install          # sweeps every 15 minutes (launchd on macOS; prints a cron line elsewhere)
```

Always start with `--dry-run`. The first real sweep on a long-lived setup can archive dozens of stale workspaces at once.

| Command | Description |
| --- | --- |
| `sweep [--dry-run] [--host <id>] [--verbose]` | Archive whatever is idle. `--verbose` also lists what was kept and why. |
| `list [--all] [--host <id>]` | List archives. `--all` includes restored and purged ones. |
| `show <id> [--scrollback]` | Show one archive, optionally with its saved output. |
| `restore <id>` | Bring an archive back. |
| `purge [--dry-run]` | Delete checkouts of long-archived, fully pushed workspaces. |
| `doctor` | Print config and data paths and whether each host is reachable. |
| `init [--force]` | Write the default config. |
| `schedule install\|uninstall [--every 15m]` | Run `sweep` on a timer. |

Every command accepts `--json` for scripting and `--config <path>` to use another config file.

## Configuration

`~/.config/tabkeeper/config.json` (override with `TABKEEPER_CONFIG` or `--config`):

```json
{
  "sessionIdle": "12h",
  "workspaceIdle": "7d",
  "scrollbackLines": 2000,
  "protect": {
    "paths": ["~/dev/infra"],
    "titles": ["npm run dev", "^ssh "]
  },
  "purge": { "enabled": false, "after": "30d" },
  "hosts": {
    "orca": { "enabled": true },
    "cmux": { "enabled": true, "bin": "/Applications/cmux.app/Contents/Resources/bin/cmux" }
  },
  "plugins": []
}
```

- **Durations** accept `s`, `m`, `h`, `d`, and `w`, and can be combined (`1d12h`).
- **`protect.titles`** are case-insensitive regular expressions.
- **Archives** live in `~/.local/share/tabkeeper`, or in `TABKEEPER_HOME` if set. There is one JSON file per record plus plain-text scrollback, so everything can be inspected with ordinary tools.

## Hosts

| Host | Activity signal | Busy signal | Archiving a workspace | Agent resume | Purge |
| --- | --- | --- | --- | --- | --- |
| **Orca** | terminal `lastOutputAt`, worktree `lastActivityAt` | title spinner, agent hook state | archive flag + native sleep (falls back to closing tabs when the runtime is unreachable) | Orca agent hooks | ✓ `orca worktree rm` |
| **cmux** | event log, agent session updates, screen fingerprints | agent lifecycle `running` | close workspace | cmux session records | — |
| **tmux** (plugin example) | `window_activity` | foreground process is not a shell | kill session | Claude transcript match | — |

Some hosts do not record when a tab was last active. For those, an adapter can report a *fingerprint* of what the tab currently shows. tabkeeper remembers each fingerprint between sweeps and treats a tab as idle from the first sweep that saw its current content. This is how cmux works without per-tab timestamps.

## Adding a host

A host is one object implementing `HostAdapter`. The core never imports a host, and a host never imports the core's internals. [`examples/tmux-plugin.mjs`](examples/tmux-plugin.mjs) is a complete tmux host in about 100 lines of plain JavaScript:

```jsonc
{
  "plugins": ["./tmux-plugin.mjs"],            // resolved relative to the config file
  "hosts": { "tmux": { "socket": "default" } } // extra keys reach the plugin as `options.settings`
}
```

```ts
import type { AdapterFactory, HostAdapter } from 'tabkeeper'

export const id = 'zellij'
export const createAdapter: AdapterFactory = (options, { runner }) => ({
  id,
  probe, // is the host running?
  inventory, // workspaces → sessions, with activity, busy, focused, pinned
  readScrollback, // recent output to store in the archive
  closeSession, // close one tab
  archiveWorkspace, // hide or close a whole workspace; return 'native' or 'closed'
  restore, // bring a workspace back and reopen tabs from specs
  // removeWorkspace, // optional: delete the checkout, which enables purge
})
```

Contract notes:

- **`inventory` reports only what the host actually knows.** Leave `lastActivityAt` undefined rather than inventing a value, and return a `fingerprint` instead when that is all the host can offer.
- **`archiveWorkspace` returns `'native'`** only when the host will resume the workspace's sessions on its own when it is shown again.
- **`archiveWorkspace` throws `PartialArchiveError`** when it had already closed some sessions before failing. tabkeeper then keeps the snapshot. For any other error, it drops the snapshot and tries again on the next sweep.
- **`restore` receives an empty session list** for native archives.
- **Handles are opaque to the core.** `ref` strings go back to the adapter unchanged, so they can encode anything the host needs.

## Library use

Everything the CLI does is exported:

```ts
import { createApp } from 'tabkeeper'

const app = await createApp({ hosts: ['orca'] })
const reports = await app.sweep.run({ dryRun: true })
```

To build your own composition (another store, another scheduler, extra agent locators), wire `SweepService`, `RestoreService`, `PurgeService`, and your own implementations of the `ArchiveStore`, `AgentLocator`, and `ActivityLedger` ports.

## Architecture

```
src/
├── domain/      model + the pure archiving policy (no I/O)
├── ports/       interfaces the core depends on: HostAdapter, ArchiveStore, AgentLocator, ActivityLedger, WorkspaceGuard
├── app/         use cases: sweep, restore, purge, snapshot capture, observed activity
├── infra/       filesystem store and ledger, git guard, Claude Code locator, process runner
├── adapters/    orca/ and cmux/: each maps one host onto HostAdapter
├── hosts/       adapter registry and plugin loading
├── config/      config parsing and paths
└── cli/         composition root, commands, rendering
```

Dependencies point inward. `domain` depends on nothing. `app` depends on `domain` and `ports`. Adapters and infrastructure implement ports: the plugin contract (`HostPlugin`, `AdapterFactory`, `CommandRunner`) lives in `ports/`, so a host needs nothing else from tabkeeper. `cli/app.ts` is the only file that knows every concrete class.

A single lock file serializes `sweep`, `restore`, and `purge`, so a scheduled sweep never races a manual command.

## Known limitations

- **Restore is not transactional.** If a restore fails partway through, the archive stays `archived`, and retrying can open some tabs twice.
- **Activity is read once per sweep.** A tab that becomes active between the inventory and the moment it is closed can still be archived. It can be restored with its scrollback and agent conversation.
- **Orca's archive and sleep calls are internal runtime methods.** If a future Orca drops them, tabkeeper falls back to closing tabs.

## Development

```sh
npm install
npm test          # unit tests plus a real tmux end-to-end test when tmux is installed
npm run typecheck
npm run build
```

## License

MIT
