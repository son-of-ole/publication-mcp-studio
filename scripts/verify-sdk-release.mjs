import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = fileURLToPath(new URL('..', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'publication-sdk-release-'))
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0 || result.error) throw new Error(result.error?.message || result.stdout + result.stderr)
  return result.stdout
}
try {
  for (const name of ['publication-client', 'publication-platform']) run('pnpm', ['pack', '--pack-destination', temporary], resolve(root, 'packages', name))
  const tarballs = (await readdir(temporary)).filter(name => name.endsWith('.tgz')).map(name => join(temporary, name))
  for (const file of tarballs) {
    const entries = run('tar', ['-tzf', file]).trim().split('\n')
    if (entries.some(name => !/^package\/(?:dist\/|migrations\/|package\.json$|README\.md$|CHANGELOG\.md$|LICENSE(?:\.md)?$)/.test(name))) throw new Error('Unexpected file in SDK tarball: ' + entries.filter(name => !/^package\/(?:dist\/|migrations\/|package\.json$|README\.md$|CHANGELOG\.md$|LICENSE(?:\.md)?$)/.test(name)).join(', '))
  }
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ name: 'publication-release-consumer', private: true, type: 'module' }))
  run('pnpm', ['add', '--ignore-scripts', ...tarballs], temporary)
  await writeFile(join(temporary, 'consumer.mjs'), `
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createLocalPublicationPlatform, createPublicationFetchHandler } from '@publication-mcp-studio/platform'
import { createPublicPublicationFetchHandler } from '@publication-mcp-studio/platform/public'
import { publicationMarkdownWithAttachments } from '@publication-mcp-studio/platform/attachments'
import { runPublicationMcpStdio } from '@publication-mcp-studio/platform/stdio'
import { createPublicationAssetTools } from '@publication-mcp-studio/platform/assets'
import { createPublicationClient } from '@publication-mcp-studio/client'
const root = await mkdtemp(join(tmpdir(), 'pub-installed-'))
try {
 const cliEnv={...process.env,PUBLICATION_PLATFORM_ADAPTER:'local',PUBLICATION_LOCAL_ROOT_DIR:root,PUBLICATION_LOCAL_SEED_DEMO_CONTENT:'false',PUBLICATION_API_SECRET:'test-only-cli-signing-secret-at-least-thirty-two-characters'}
 const cli=spawnSync(process.execPath,['node_modules/@publication-mcp-studio/platform/dist/cli.js','issue-token','--json'],{encoding:'utf8',env:cliEnv})
 assert.equal(cli.status,0,cli.stderr)
 const cliIssued=JSON.parse(cli.stdout);assert.ok(cliIssued.token.scopes.includes('articles:publish'));assert.ok(!cliIssued.token.scopes.includes('tokens:write'))
 const invalid=spawnSync(process.execPath,['node_modules/@publication-mcp-studio/platform/dist/cli.js','issue-token','--scope','typo'],{encoding:'utf8',env:cliEnv})
 assert.equal(invalid.status,1)
 const platform=createLocalPublicationPlatform({rootDir:root,seedDemoContent:false})
 const handler=createPublicationFetchHandler({platform,basePath:'/api/publications',staticTokens:['test-only-consumer']})
 const client=createPublicationClient({origin:'http://engine.invalid',token:'test-only-consumer',fetch:(url,init)=>handler(new Request(url,init))})
 const {article}=await client.createArticle({title:'Installed SDK',slug:'installed-sdk',body:'Content from installed packages.'})
 const {asset}=await client.uploadMedia({identifier:article.id,fileName:'evidence.pdf',data:new TextEncoder().encode('%PDF-test')})
 await client.attachMedia(article.id,{url:asset.publicUrl,label:'Evidence',textContent:'Readable attachment text.'})
 await client.publishArticle(article.id)
 const publicHandler=createPublicPublicationFetchHandler({store:platform.publicationStore,mediaStore:platform.mediaStore,siteUrl:'https://publisher.invalid'})
 const response=await publicHandler(new Request('https://publisher.invalid/publications/installed-sdk.md'))
 assert.equal(response.status,200);assert.match(await response.text(),/Readable attachment text/)
 const revision=await client.createRevision(article.id);const review=await client.preparePublication(revision.article.id);await client.publishRevision(revision.article.id,review.digest)
 await client.unpublishArticle(article.id);assert.equal((await publicHandler(new Request('https://publisher.invalid'+asset.publicUrl))).status,404)
 assert.equal(typeof publicationMarkdownWithAttachments,'function');assert.equal(typeof runPublicationMcpStdio,'function');assert.equal(typeof createPublicationAssetTools,'function')
} finally {await rm(root,{recursive:true,force:true})}
`)
  run(process.execPath, ['consumer.mjs'], temporary)
  await writeFile(join(temporary, 'consumer.mts'), `import { createPublicationClient, PUBLICATION_AGENT_SCOPES } from '@publication-mcp-studio/client';\nimport { createLocalPublicationPlatform, createPublicationFetchHandler, type PublicationAttachment } from '@publication-mcp-studio/platform';\nimport { publicationMarkdownWithAttachments } from '@publication-mcp-studio/platform/attachments';\nconst client = createPublicationClient({origin:'https://engine.invalid'});\nconst platform = createLocalPublicationPlatform({seedDemoContent:false});\nconst handler = createPublicationFetchHandler({platform});\nvoid client.uploadMedia({identifier:'draft',fileName:'test.pdf',data:new Uint8Array(1)});\nvoid client.createRevision('live');void client.attachMedia('draft',{url:'/asset',textContent:'text'});void PUBLICATION_AGENT_SCOPES;void handler;void publicationMarkdownWithAttachments;\nconst attachment: PublicationAttachment | undefined = undefined;void attachment;\n`)
  run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--skipLibCheck', '--module', 'nodenext', '--target', 'ES2022', '--lib', 'ES2022,DOM', 'consumer.mts'], temporary)
  console.log('SDK release verification passed: real tarballs, clean consumer install, runtime publishing/attachments/revisions and TypeScript declarations.')
} finally { await rm(temporary, {recursive:true,force:true}) }
