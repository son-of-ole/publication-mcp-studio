import { access, copyFile } from 'node:fs/promises'
import path from 'node:path'

const rootDir = process.cwd()
const sourceEnv = path.join(rootDir, '.env.example')
const targetEnv = path.join(rootDir, '.env.local')

try {
  await access(targetEnv)
  console.log('.env.local already exists.')
} catch {
  await copyFile(sourceEnv, targetEnv)
  console.log('Created .env.local from .env.example.')
}

console.log('')
console.log('Next steps:')
console.log('1. Choose PUBLICATION_PLATFORM_ADAPTER=local, neon, or supabase')
console.log('2. Set PUBLICATION_ADMIN_EMAIL and PUBLICATION_ADMIN_PASSWORD')
console.log('3. Set PUBLICATION_API_SECRET for signed MCP tokens')
console.log('4. Run npm run dev')
