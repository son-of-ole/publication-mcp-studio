# Hosted Client Template

Use this template when another app wants to integrate with a deployed Publication MCP Studio service instead of embedding the backend.

## Install

```bash
npm install @publication-mcp-studio/client
```

## Example

See [example.ts](/Users/olson/Software/publication-mcp-studio/templates/hosted-client/example.ts).

Hosted mode is the easiest path when:

- the external app just needs article access or MCP workflows
- the publication service can run as its own deployment
- the integrating team wants a small client SDK instead of storage adapters
