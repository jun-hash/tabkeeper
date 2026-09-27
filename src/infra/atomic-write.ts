import { rename, writeFile } from 'node:fs/promises'

export async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, content, 'utf8')
  await rename(temp, path)
}
