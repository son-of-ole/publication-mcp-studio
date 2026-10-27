#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { getPublicationPlatform } from './index'
import { readFile } from 'node:fs/promises'
import { runPublicationMcpStdio } from './stdio'
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
  if (process.argv.includes('--help') || process.argv.includes('-h')) { printHelp(); return }
  if (process.argv[2] === 'stdio') {
    const index = process.argv.indexOf('--connection-file')
    const file = index >= 0 ? process.argv[index + 1] : undefined
    if (!file) throw new Error('stdio requires --connection-file /private/path/to/connection.json')
    async function connection() {
      const data = JSON.parse(await readFile(file!, 'utf8')).mcpServers?.publicationEngine
      if (typeof data?.url !== 'string' || typeof data?.headers?.Authorization !== 'string') throw new Error('Invalid publication connection file.')
      return data as { url: string; headers: { Authorization: string } }
    }
    const first = await connection()
    await runPublicationMcpStdio({ url: first.url, getAuthorization: async () => {
      const next = await connection()
      if (next.url !== first.url) throw new Error('Connection origin changed; restart the harness bridge.')
      return next.headers.Authorization
    } })
    return
  }
  const args = parseArgs(process.argv.slice(2))

  if (args.command !== 'issue-token') {
    printHelp()
    process.exitCode = args.command ? 1 : 0
    return
  }

  const secret = readRequiredEnv(['PUBLICATION_TOKEN_SECRET', 'PUBLICATION_API_SECRET'])
  if (secret.length < 32) throw new Error('Use a signing secret of at least 32 characters.')
  const issuedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000).toISOString()

  const platform = getPublicationPlatform()
  await platform.ensureSchema()
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
    scopes: ['mcp:connect', 'articles:read', 'articles:write', 'articles:publish'],
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
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) throw new Error('Expiry must be an integer between 1 and 365 days.')
      args.expiresInDays = parsed
      index += 1
    } else if (arg === '--json') {
      args.json = true
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  return args
}

function normalizeScopes(value: string): PublicationTokenScope[] {
  const requested = value.split(',').map(scope => scope.trim())
  if (!requested.length || requested.some(scope => !(PUBLICATION_TOKEN_SCOPES as readonly string[]).includes(scope))) throw new Error('Every requested scope must be a supported publication scope.')
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
  publication-mcp stdio --connection-file /private/path/to/connection.json

Environment:
  PUBLICATION_PLATFORM_ADAPTER=local|neon|supabase and its private configuration
  PUBLICATION_TOKEN_SECRET or PUBLICATION_API_SECRET
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
