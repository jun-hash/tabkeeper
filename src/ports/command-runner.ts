export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface RunOptions {
  readonly cwd?: string
  readonly timeoutMs?: number
  readonly env?: Readonly<Record<string, string | undefined>>
}

/** Runs a program without a shell; a non-zero exit is reported, not thrown. */
export type CommandRunner = (command: string, args: readonly string[], options?: RunOptions) => Promise<CommandResult>
