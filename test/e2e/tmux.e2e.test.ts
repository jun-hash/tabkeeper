import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/cli/app.js'

const SOCKET = `tabkeeper-test-${process.pid}`
const hasTmux = (() => {
  try {
    execFileSync('tmux', ['-V'])
    return true
  } catch {
    return false
  }
})()

const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8' })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!hasTmux)('tmux plugin end to end', () => {
  let configPath: string

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tabkeeper-e2e-'))
    configPath = join(dir, 'config.json')
    process.env.TABKEEPER_HOME = join(dir, 'data')
    await copyFile(resolve('examples/tmux-plugin.mjs'), join(dir, 'tmux-plugin.mjs'))
    await writeFile(
      configPath,
      JSON.stringify({
        sessionIdle: '2s',
        workspaceIdle: '3s',
        hosts: { orca: { enabled: false }, cmux: { enabled: false }, tmux: { socket: SOCKET } },
        plugins: ['./tmux-plugin.mjs'],
      }),
    )

    tmux('new-session', '-d', '-s', 'stale', '-n', 'lonely', '-c', tmpdir())
    tmux('new-session', '-d', '-s', 'proj', '-n', 'old', '-c', tmpdir())
    tmux('send-keys', '-t', 'proj:old', 'echo MARKER', 'Enter')
    tmux('new-window', '-d', '-t', 'proj:', '-n', 'fresh')
    await sleep(4000)
    tmux('send-keys', '-t', 'proj:fresh', 'echo alive', 'Enter')
    await sleep(300)
  }, 20_000)

  afterAll(() => {
    try {
      tmux('kill-server')
    } catch {}
  })

  it('archives idle windows and sessions, keeps scrollback, and restores them', async () => {
    const app = await createApp({ configPath, hosts: ['tmux'] })

    const [report] = await app.sweep.run({ dryRun: false })
    expect(report).toMatchObject({ status: 'ok', failures: [] })
    expect(tmux('list-windows', '-a', '-F', '#{session_name}:#{window_name}').trim()).toBe('proj:fresh')

    const records = await app.store.list({ status: 'archived' })
    const window = records.find((r) => r.kind === 'session')
    const session = records.find((r) => r.kind === 'workspace')
    expect(window?.sessions[0]?.title).toBe('old')
    expect(await app.store.scrollback(window!.id, window!.sessions[0]!.ref)).toContain('MARKER')

    await app.restore.run(window!.id)
    await app.restore.run(session!.id)

    const windows = tmux('list-windows', '-a', '-F', '#{session_name}:#{window_name}').trim().split('\n').sort()
    expect(windows).toEqual(['proj:fresh', 'proj:old', 'stale:lonely'])
  })
})
