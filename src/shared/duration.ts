const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const

export function parseDuration(input: string): number {
  const text = input.trim()
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*([smhdw])/g)]
  const consumed = parts.map((p) => p[0]).join('')
  if (parts.length === 0 || consumed.replace(/\s/g, '') !== text.replace(/\s/g, '')) {
    throw new Error(`Invalid duration "${input}". Use forms like 30m, 12h, 7d, or 1d12h.`)
  }
  return parts.reduce((total, [, amount, unit]) => total + Number(amount) * UNIT_MS[unit as keyof typeof UNIT_MS], 0)
}

const DISPLAY_UNITS = ['d', 'h', 'm', 's'] as const

export function formatDuration(ms: number): string {
  for (const [index, unit] of DISPLAY_UNITS.entries()) {
    const size = UNIT_MS[unit]
    if (ms < size && unit !== 's') continue
    const whole = Math.floor(ms / size)
    const next = DISPLAY_UNITS[index + 1]
    const rest = next ? Math.floor((ms - whole * size) / UNIT_MS[next]) : 0
    return next && rest > 0 ? `${whole}${unit}${rest}${next}` : `${whole}${unit}`
  }
  return '0s'
}
