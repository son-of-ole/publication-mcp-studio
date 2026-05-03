#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { createNeonPublicationPlatform, migrateNeonPublicationPlatform } from './neon'
import { issuePublicationToken } from './auth'
import { PUBLICATION_TOKEN_SCOPES, type PublicationTokenScope } from './token-scopes'

type ParsedArgs = {
  command?: string
  label: string
  scopes: PublicationTokenScope[]
  expiresInDays: number
  json: boolean
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.command !== 'issue-token') {
    printHelp()
    process.exitCode = args.command ? 1 : 0
    return
  }

  const databaseUrl = readRequiredEnv(['NEON_DATABASE_URL', 'DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL'])
  const secret = readRequiredEnv(['PUBLICATION_TOKEN_SECRET', 'PUBLICATION_API_SECRET'])
  const issuedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000).toISOString()

  await migrateNeonPublicationPlatform({ databaseUrl })
  const platform = createNeonPublicationPlatform({ databaseUrl })
  const tokenRecord = await platform.tokenStore.createTokenRecord({
    label: args.label,
    scopes: args.scopes,
    issuedAt,
    expiresAt,
  })
  const token = issuePublicationToken({
    tokenId: tokenRecord.id || randomUUID(),
    label: tokenRecord.label,
    scopes: tokenRecord.scopes,
    issuedAt: tokenRecord.issuedAt,
    expiresAt: tokenRecord.expiresAt,
    secret,
  })

  if (args.json) {
    console.log(JSON.stringify({ token, tokenRecord }, null, 2))
    return
  }

  console.log(token.token)
  console.error(`Issued ${token.label} (${token.tokenId}) with scopes: ${token.scopes.join(', ')}`)
  console.error(`Expires: ${token.expiresAt}`)
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: argv[0],
    label: 'Publication MCP Integration Token',
    scopes: ['mcp:connect', 'articles:read'],
    expiresInDays: 30,
    json: false,
  }

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--label' && next) {
      args.label = next
      index += 1
    } else if (arg === '--scopes' && next) {
      args.scopes = normalizeScopes(next)
      index += 1
    } else if (arg === '--expires-in-days' && next) {
      const parsed = Number(next)
      args.expiresInDays = Number.isFinite(parsed) ? Math.min(365, Math.max(1, Math.floor(parsed))) : args.expiresInDays
      index += 1
    } else if (arg === '--json') {
      args.json = true
    }
  }

  return args
}

function normalizeScopes(value: string): PublicationTokenScope[] {
  const scopes = value
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope): scope is PublicationTokenScope => (PUBLICATION_TOKEN_SCOPES as readonly string[]).includes(scope))

  return scopes.length > 0 ? [...new Set(scopes)] : ['mcp:connect', 'articles:read']
}

function readRequiredEnv(names: string[]) {
  const value = names.map((name) => process.env[name]?.trim()).find(Boolean)
  if (!value) {
    throw new Error(`Missing required env var. Set one of: ${names.join(', ')}`)
  }
  return value
}

function printHelp() {
  console.log(`Publication MCP Studio CLI

Usage:
  publication-mcp issue-token --label "My App" --scopes mcp:connect,articles:read --json

Environment:
  DATABASE_URL or NEON_DATABASE_URL
  PUBLICATION_TOKEN_SECRET or PUBLICATION_API_SECRET
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
