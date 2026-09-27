// A complete tabkeeper host written as a plugin: tmux sessions are workspaces, tmux windows are sessions.
// Enable it with  { "plugins": ["./tmux-plugin.mjs"], "hosts": { "tmux": { "socket": "default" } } }

const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'nu', 'login'])
const FIELDS = [
  'session_id',
  'session_name',
  'session_path',
  'session_attached',
  'window_id',
  'window_name',
  'window_active',
  'window_activity',
  'pane_current_path',
  'pane_current_command',
]

/** @type {import('tabkeeper').HostPlugin['id']} */
export const id = 'tmux'

/** @type {import('tabkeeper').AdapterFactory} */
export function createAdapter(options, { runner }) {
  const bin = options.bin ?? 'tmux'
  const socket = typeof options.settings.socket === 'string' ? ['-L', options.settings.socket] : []

  const tmux = async (...args) => {
    const result = await runner(bin, [...socket, ...args])
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `tmux exited with ${result.exitCode}`)
    return result.stdout
  }

  const sendCommand = (target, command) => (command ? tmux('send-keys', '-t', target, command, 'Enter') : undefined)

  return {
    id,

    async probe() {
      try {
        await tmux('list-sessions')
        return { available: true }
      } catch (error) {
        return { available: false, reason: error.message }
      }
    },

    async inventory() {
      const format = FIELDS.map((f) => `#{${f}}`).join('\t')
      const rows = (await tmux('list-windows', '-a', '-F', format))
        .split('\n')
        .filter(Boolean)
        .map((line) => Object.fromEntries(line.split('\t').map((value, i) => [FIELDS[i], value])))

      const workspaces = new Map()
      for (const row of rows) {
        const attached = row.session_attached !== '0'
        const workspace = workspaces.get(row.session_id) ?? {
          ref: row.session_id,
          title: row.session_name,
          path: row.session_path,
          pinned: false,
          focused: attached,
          permanent: false,
          sessions: [],
        }
        workspace.sessions.push({
          ref: row.window_id,
          title: row.window_name,
          cwd: row.pane_current_path,
          lastActivityAt: Number(row.window_activity) * 1000,
          busy: !SHELLS.has(row.pane_current_command),
          focused: attached && row.window_active === '1',
        })
        workspaces.set(row.session_id, workspace)
      }
      return [...workspaces.values()]
    },

    async readScrollback(_workspace, session, lines) {
      return tmux('capture-pane', '-p', '-J', '-S', `-${lines}`, '-t', session.ref)
    },

    async closeSession(_workspace, session) {
      await tmux('kill-window', '-t', session.ref)
    },

    async archiveWorkspace(workspace) {
      await tmux('kill-session', '-t', workspace.ref)
      return 'closed'
    },

    async restore(snapshot, sessions) {
      const name = `=${snapshot.title}`
      const exists = await tmux('has-session', '-t', name).then(
        () => true,
        () => false,
      )
      const pending = [...sessions]

      if (!exists) {
        const first = pending.shift()
        const cwd = first?.cwd ?? snapshot.path
        await tmux(
          'new-session',
          '-d',
          '-s',
          snapshot.title,
          ...(cwd ? ['-c', cwd] : []),
          ...(first ? ['-n', first.title] : []),
        )
        if (first) await sendCommand(`${name}:`, first.command)
      }
      for (const spec of pending) {
        const window = (
          await tmux(
            'new-window',
            '-d',
            '-P',
            '-F',
            '#{window_id}',
            '-t',
            `${name}:`,
            '-n',
            spec.title,
            ...(spec.cwd ? ['-c', spec.cwd] : []),
          )
        ).trim()
        await sendCommand(window, spec.command)
      }
    },
  }
}
