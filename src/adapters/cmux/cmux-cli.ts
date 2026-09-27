import type { CommandRunner } from '../../ports/command-runner.js'

export class CmuxError extends Error {}

/**
 * Wraps the `cmux` socket CLI. UUID handles are always requested (refs like `surface:3` get renumbered),
 * and the caller's own CMUX_WORKSPACE_ID/CMUX_SURFACE_ID are cleared so they never become implicit targets.
 */
export class CmuxCli {
  private static readonly ENV = { CMUX_QUIET: '1', CMUX_WORKSPACE_ID: undefined, CMUX_SURFACE_ID: undefined }

  constructor(
    private readonly runner: CommandRunner,
    private readonly bin: string,
  ) {}

  async json<T>(args: readonly string[]): Promise<T> {
    const stdout = await this.exec(['--json', '--id-format', 'uuids', ...args])
    try {
      return JSON.parse(stdout) as T
    } catch {
      throw new CmuxError(`cmux ${args[0] ?? ''}: unexpected output: ${stdout.slice(0, 200)}`)
    }
  }

  async exec(args: readonly string[]): Promise<string> {
    const { stdout, stderr, exitCode } = await this.runner(this.bin, args, { env: CmuxCli.ENV })
    if (exitCode !== 0) throw new CmuxError((stderr || stdout).trim().replace(/^Error:\s*/, '') || `cmux exited with ${exitCode}`)
    return stdout
  }
}
