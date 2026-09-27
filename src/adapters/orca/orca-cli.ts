import type { CommandRunner } from '../../ports/command-runner.js'
import type { OrcaEnvelope } from './orca-types.js'

export class OrcaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`orca: ${message} (${code})`)
  }
}

/** Thin typed wrapper over `orca <command> --json`, which always answers with an `{ ok, result | error }` envelope. */
export class OrcaCli {
  constructor(
    private readonly runner: CommandRunner,
    private readonly bin: string,
  ) {}

  async json<T>(args: readonly string[]): Promise<T> {
    const { stdout, stderr, exitCode } = await this.runner(this.bin, [...args, '--json'])
    let envelope: OrcaEnvelope<T>
    try {
      envelope = JSON.parse(stdout) as OrcaEnvelope<T>
    } catch {
      throw new OrcaError('invalid_output', (stderr || stdout).trim() || `exit code ${exitCode}`)
    }
    if (!envelope.ok || envelope.result === undefined) {
      throw new OrcaError(envelope.error?.code ?? 'unknown', envelope.error?.message ?? 'request failed')
    }
    return envelope.result
  }
}
