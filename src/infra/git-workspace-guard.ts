import type { WorkspaceGuard } from '../ports/workspace-guard.js'
import type { CommandRunner } from '../ports/command-runner.js'
import { messageOf } from '../shared/errors.js'
import { runChecked } from './command-runner.js'

/**
 * Refuses to let a checkout be deleted while it holds uncommitted, untracked, unpushed, or stashed work.
 * Git-ignored files are not considered work and are deleted with the checkout.
 */
export class GitWorkspaceGuard implements WorkspaceGuard {
  constructor(private readonly runner: CommandRunner) {}

  async riskOf(path: string): Promise<string | undefined> {
    const git = (...args: string[]) => runChecked(this.runner, 'git', ['-C', path, ...args])
    try {
      if ((await git('status', '--porcelain', '--untracked-files=all')).trim()) return 'has uncommitted or untracked files'
      if ((await git('stash', 'list')).trim()) return 'has stashed changes'
      const upstream = await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').catch(() => '')
      if (!upstream.trim()) return 'branch has no upstream'
      if ((await git('rev-list', '--count', '@{upstream}..HEAD')).trim() !== '0') return 'has unpushed commits'
      return undefined
    } catch (error) {
      return `git check failed: ${messageOf(error)}`
    }
  }
}
