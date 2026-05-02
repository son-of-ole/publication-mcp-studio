import { NextResponse } from 'next/server'
import { MCP_PROTOCOL_VERSION, MCP_SERVER_NAME, TOOL_DEFINITIONS } from '@/app/api/publications/mcp/route'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({
    ok: true,
    protocolVersion: MCP_PROTOCOL_VERSION,
    server: MCP_SERVER_NAME,
    tools: TOOL_DEFINITIONS.length,
    toolNames: TOOL_DEFINITIONS.map((tool) => tool.name),
  })
}
