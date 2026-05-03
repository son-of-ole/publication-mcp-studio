#!/usr/bin/env node
// Smoke-test the package.json that will actually ship.
// Catches regressions like the 0.3.0 publish where exports pointed to
// ./src/*.ts files that were not in the tarball.
import { readFile, access } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const pkg = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'))

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

async function exists(rel) {
  try { await access(join(pkgRoot, rel)); return true } catch { return false }
}

const filesGlobs = pkg.files ?? []
const shippedRoots = new Set(filesGlobs.map((f) => f.replace(/\/$/, '')))

// Helper: every export target must live under a shipped root AND exist on disk.
async function checkTarget(label, target) {
  if (!target.startsWith('./')) fail(`${label}: target "${target}" must be relative (start with ./)`)
  const rel = target.replace(/^\.\//, '')
  const root = rel.split('/')[0]
  if (!shippedRoots.has(root) && !shippedRoots.has(rel)) {
    fail(`${label}: target "${target}" is not under any path in "files" (${[...shippedRoots].join(', ')})`)
  }
  if (!(await exists(rel))) fail(`${label}: target "${target}" does not exist on disk — did you forget to run \`pnpm build\`?`)
}

if (!pkg.main) fail('package.json must define "main"')
await checkTarget('main', pkg.main)

if (pkg.types) await checkTarget('types', pkg.types)

if (pkg.bin) {
  for (const [name, target] of Object.entries(typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin)) {
    const t = target.startsWith('./') ? target : './' + target
    await checkTarget(`bin.${name}`, t)
  }
}

if (!pkg.exports) fail('package.json must define "exports"')
for (const [subpath, value] of Object.entries(pkg.exports)) {
  const targets = typeof value === 'string' ? [value] : Object.values(value)
  for (const t of targets) {
    await checkTarget(`exports["${subpath}"]`, t)
  }
}

console.log(`✓ tarball verification passed for ${pkg.name}@${pkg.version}`)
console.log(`  ${Object.keys(pkg.exports).length} export entries, all targets exist under [${[...shippedRoots].join(', ')}]`)
