export function maxDefined(values: readonly (number | null | undefined)[]): number | undefined {
  const known = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return known.length > 0 ? Math.max(...known) : undefined
}

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const group = groups.get(k)
    if (group) group.push(item)
    else groups.set(k, [item])
  }
  return groups
}
