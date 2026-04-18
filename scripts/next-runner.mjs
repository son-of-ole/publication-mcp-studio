import { spawn } from 'node:child_process'

const nextArgs = process.argv.slice(2)

if (nextArgs.length === 0) {
  console.error('Usage: node scripts/next-runner.mjs <next-command>')
  process.exit(1)
}

const child = spawn(
  process.execPath,
  ['./node_modules/next/dist/bin/next', ...nextArgs],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: 'true',
      BROWSERSLIST_IGNORE_OLD_DATA: 'true',
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  },
)

function forwardStream(stream, target) {
  let buffer = ''

  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.includes('[baseline-browser-mapping]')) {
        target.write(`${line}\n`)
      }
    }
  })

  stream.on('end', () => {
    if (buffer && !buffer.includes('[baseline-browser-mapping]')) {
      target.write(buffer)
    }
  })
}

forwardStream(child.stdout, process.stdout)
forwardStream(child.stderr, process.stderr)

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
