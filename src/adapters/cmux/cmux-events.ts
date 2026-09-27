import { open } from 'node:fs/promises'

const DEFAULT_TAIL_BYTES = 4 * 1024 * 1024

interface EventFrame {
  readonly occurred_at?: string
  readonly workspace_id?: string | null
  readonly surface_id?: string | null
}

/** cmux exposes no activity timestamps, but its event log stamps every focus, prompt, hook and notification. */
export async function readLastEventTimes(path: string, tailBytes = DEFAULT_TAIL_BYTES): Promise<Map<string, number>> {
  const latest = new Map<string, number>()
  const text = await readTail(path, tailBytes).catch(() => '')

  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let frame: EventFrame
    try {
      frame = JSON.parse(line) as EventFrame
    } catch {
      continue
    }
    const at = frame.occurred_at ? Date.parse(frame.occurred_at) : Number.NaN
    if (Number.isNaN(at)) continue
    for (const raw of [frame.workspace_id, frame.surface_id]) {
      const id = raw?.toLowerCase()
      if (id && at > (latest.get(id) ?? 0)) latest.set(id, at)
    }
  }
  return latest
}

async function readTail(path: string, bytes: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}
