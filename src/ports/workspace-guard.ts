export interface WorkspaceGuard {
  /** Returns a reason when deleting the checkout at `path` could lose work; undefined when it is safe. */
  riskOf(path: string): Promise<string | undefined>
}
