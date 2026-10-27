import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export async function acquireLocalEngineLock(root: string) {
  const directory = path.join(root, '.publication-mcp-studio')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = path.join(directory, 'engine.lock'), owner = `${process.pid}:${randomUUID()}`
  try { await writeFile(file, owner, { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Local engine lock exists at ${file}. Check its recorded PID before recovering a stale lock; never run two engines on this filesystem store.`)
    throw error
  }
  return async () => { if (await readFile(file, 'utf8') === owner) await unlink(file) }
}
