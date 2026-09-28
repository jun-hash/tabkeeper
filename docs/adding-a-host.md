# Adding a host

A "host" is an app that has tabs, like Orca, cmux, or tmux. To support a new one, write a plugin: a module that exports `id` and `createAdapter`.

[`examples/tmux-plugin.mjs`](../examples/tmux-plugin.mjs) is a complete, working example.

## Enable a plugin

```jsonc
{
  "plugins": ["./my-plugin.mjs"],          // path is relative to the config file
  "hosts": { "myapp": { "socket": "x" } }  // extra keys are passed to the plugin as options.settings
}
```

## Write the adapter

```ts
import type { AdapterFactory } from 'tabkeeper'

export const id = 'myapp'

export const createAdapter: AdapterFactory = (options, { runner }) => ({
  id,
  probe,            // Is the app running?
  inventory,        // List workspaces and their tabs.
  readScrollback,   // Return a tab's recent output.
  closeSession,     // Close one tab.
  archiveWorkspace, // Close or hide a whole workspace. Return 'native' or 'closed'.
  restore,          // Reopen a workspace and its tabs.
  removeWorkspace,  // Optional. Delete the workspace from disk. Enables purge.
})
```

Use `runner` to call the app's CLI. It never throws on a non-zero exit code; check `exitCode` yourself.

## Rules

- **Report only what the app knows.** If you don't know when a tab was last used, leave `lastActivityAt` empty. tabkeeper will not close it.
- **No timestamps?** Return a `fingerprint` instead, such as a hash of the visible screen. tabkeeper treats the tab as idle from the first sweep that saw the current content.
- **Return `'native'`** from `archiveWorkspace` only if the app will reopen the tabs itself. `restore` then receives an empty tab list.
- **Throw `PartialArchiveError`** if `archiveWorkspace` closed some tabs before it failed. tabkeeper keeps the saved snapshot. For other errors it drops the snapshot and tries again next time.
- **`ref` values are yours.** tabkeeper passes them back unchanged, so they can hold any id the app needs.

## How the code is organized

```
src/
├── domain/    the rules that decide what to close (no I/O)
├── ports/     interfaces: HostAdapter, ArchiveStore, and others
├── app/       sweep, restore, and purge
├── infra/     file storage, git checks, Claude Code session lookup
├── adapters/  Orca and cmux
├── hosts/     loads built-in adapters and plugins
├── config/    reads the config file
└── cli/       commands and output
```

Code depends inward: `domain` depends on nothing, and `app` depends only on `domain` and `ports`. A plugin needs only the types in `ports/`.

## Using tabkeeper as a library

```ts
import { createApp } from 'tabkeeper'

const app = await createApp({ hosts: ['orca'] })
const reports = await app.sweep.run({ dryRun: true })
```
