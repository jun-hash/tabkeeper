import { execFile } from 'node:child_process'
import type { CommandResult, CommandRunner, RunOptions } from '../ports/command-runner.js'

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly args: readonly string[],
    readonly result: CommandResult,
  ) {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(-3).join(' ')
    super(`${command} ${args.join(' ')} exited with ${result.exitCode}${detail ? `: ${detail}` : ''}`)
  }
}

export const execRunner: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error)
        resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 })
      },
    )
  })

export async function runChecked(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  options?: RunOptions,
): Promise<string> {
  const result = await runner(command, args, options)
  if (result.exitCode !== 0) throw new CommandError(command, args, result)
  return result.stdout
}
