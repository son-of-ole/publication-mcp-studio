import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupLocalPublications, restoreLocalPublications } from '../packages/publication-platform/dist/index.js'

const [mode, ...args] = process.argv.slice(2).filter(value => value !== '--')
const root = fileURLToPath(new URL('..', import.meta.url))
const config = parseEnv(await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
const passphrase = process.env.PUBLICATION_BACKUP_PASSPHRASE || ''
if (!['backup', 'restore'].includes(mode) || args.length !== (mode === 'backup' ? 1 : 2)) throw new Error('Usage: engine:backup <new-backup-file> | engine:restore <backup-file> <new-data-root>')
if (config.PUBLICATION_PLATFORM_ADAPTER !== 'local') throw new Error('Use provider-native backups for a cloud adapter.')
const result = mode === 'backup'
  ? await backupLocalPublications({ rootDir: resolve(root, config.PUBLICATION_LOCAL_ROOT_DIR || '.publication-local-dev'), destination: resolve(args[0]), passphrase })
  : await restoreLocalPublications({ backupFile: resolve(args[0]), destinationRoot: resolve(args[1]), passphrase })
console.log(JSON.stringify(result, null, 2))
