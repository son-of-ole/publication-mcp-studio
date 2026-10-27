import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectCodexPublicationHarness } from './lib/codex-publication-harness.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)), directory = resolve(root, 'output/internal-publication')
const statePath = resolve(directory, 'state.json'), state = JSON.parse(await readFile(statePath, 'utf8'))
const phase = process.argv[2], web = 'http://127.0.0.1:5180', feed = 'http://127.0.0.1:8081'
const url = `${web}/publications/${state.slug}`
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const connection = JSON.parse(await readFile(resolve(root, '.publication-local-dev/mcp-agent-connection.json'), 'utf8')).mcpServers.publicationEngine
const checks = state.checks
function receipt(name, details = {}) { checks.push({ name, ...details, passed: true, at: new Date().toISOString() }) }
async function get(path, options = {}) { return fetch(path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(10_000) }) }
async function status(path, expected, options = {}) { const response = await get(path, options); assert.equal(response.status, expected, `${options.method || 'GET'} ${path}`); return response }
async function privateRoutes(slug = state.slug) {
  for (const path of [`${web}/publications/${slug}`, `${web}/publications/${slug}.md`, `${web}/publications/${slug}/raw`, `${web}/content/articles/${slug}`, `${feed}/articles/${slug}`]) {
    for (const headers of [{}, connection.headers]) {
      await status(path, 404, { headers }); await status(path, 404, { method: 'HEAD', headers })
    }
  }
  const actual = await (await status(`${web}/publications/${slug}`, 404)).text()
  const missing = await (await status(`${web}/publications/internal-nonexistent-20261022`, 404)).text()
  assert.equal(actual, missing)
  for (const path of [`${web}/publications`, `${web}/sitemap.xml`, `${web}/content/articles?status=all`]) assert.ok(!(await (await status(path, 200)).text()).includes(slug), path)
  receipt('Draft HTML, Markdown, raw, JSON, feed, discovery and HEAD are private even with valid credentials', { slug })
}
async function privateFile(asset) {
  for (const origin of [web, feed]) for (const method of ['GET', 'HEAD']) for (const headers of [{}, connection.headers]) await status(origin + asset.publicUrl, 404, { method, headers })
}
async function liveFile(asset) {
  const response = await status(web + asset.publicUrl, 200), bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(hash(bytes), asset.sha256); assert.equal(response.headers.get('content-type'), asset.contentType)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  if (asset.contentType === 'application/pdf' || asset.contentType === 'text/csv') assert.match(response.headers.get('content-disposition'), /^attachment/)
  const head = await status(web + asset.publicUrl, 200, { method: 'HEAD' }); assert.equal(await head.text(), '')
  receipt('Published file matches original bytes and download headers', { file: asset.sourceFile, bytes: bytes.length, sha256: asset.sha256 })
}
async function withHarness(fn) {
 const harness = await connectCodexPublicationHarness({ cwd: root })
 try {
  assert.equal(Object.keys(harness.server.tools).length, 16)
  assert.ok(!Object.keys(harness.server.tools).includes('delete_article'))
  receipt('Actual Codex MCP router connected with 16 allowed tools and no model turn', { server: harness.server.name })
  return await fn(harness)
 } finally { await harness.close() }
}
async function upload(harness, identifier, file) {
  const bytes = await readFile(resolve(directory, 'assets', file.sourceFile)), sha256 = hash(bytes)
  const started = await harness.callTool('begin_media_upload', { identifier, fileName: file.sourceFile, contentType: file.contentType, sizeBytes: bytes.length, sha256 })
  for (let offset = 0, index = 0; offset < bytes.length; offset += started.chunkBytes, index++) await harness.callTool('upload_media_chunk', { uploadId: started.uploadId, index, dataBase64: bytes.subarray(offset, offset + started.chunkBytes).toString('base64') })
  const { asset } = await harness.callTool('complete_media_upload', { uploadId: started.uploadId })
  const record = { ...asset, sourceFile: file.sourceFile, sha256, label: file.label }
  state.assets.push(record); await save()
  await privateFile(record)
  const attached = await harness.callTool('attach_media', { identifier, url: asset.publicUrl, label: file.label, description: file.description, textContent: file.textContent || '' })
  record.attachmentId = attached.attachments.find(item => item.url === asset.publicUrl).id
  await privateFile(record); await save()
  receipt('Uploaded and attached real file through Codex; still private', { file: file.sourceFile, bytes: bytes.length, sha256 })
  return record
}
async function save() { await writeFile(statePath, JSON.stringify(state, null, 2) + '\n') }
try {
 if (phase === 'upload') {
  assert.equal(state.phase, 'draft')
  const original = await (await status(`${web}/content/articles/local-stabilization-verification`, 200)).json()
  state.originalArticleDigest = hash(JSON.stringify(original.article))
  await privateRoutes()
  await status(`${web}/content/articles/${state.id}`,404)
  await withHarness(async harness => {
   const csv = await readFile(resolve(directory, 'assets/apollo-sample-types.csv'), 'utf8')
   for (const file of [
    { sourceFile:'apollo11-experiments-5948.jpg',contentType:'image/jpeg',label:'Apollo 11 surface experiments - photograph AS11-40-5948',description:'Buzz Aldrin with the seismometer and retroreflector near Eagle. Photograph by Neil Armstrong; NASA / NASA Scientific Visualization Studio. Source: https://svs.gsfc.nasa.gov/4185/' },
    { sourceFile:'apollo11-experiments-5949.jpg',contentType:'image/jpeg',label:'Apollo 11 surface experiments - photograph AS11-40-5949',description:'A second view of Aldrin and the deployed experiments. Photograph by Neil Armstrong; NASA / NASA Scientific Visualization Studio. Source: https://svs.gsfc.nasa.gov/4185/' },
    { sourceFile:'lunar-samples-allton-2009.pdf',contentType:'application/pdf',label:'Original NASA technical paper - J. H. Allton (2009)',description:'Nine-page technical PDF, NTRS document 20090011852. The publication dataset transcribes page 1, Table 1.',textContent:'Source: J. H. Allton, Lunar Samples: Apollo Collection Tools, Curation Handling, Surveyor III and Soviet Luna Samples (2009), NASA Johnson Space Center. Table 1 reports percentages by number and weight for rock, rake, soil, soil fragments and soil core samples. This is a harness-supplied description; the publishing engine does not parse or execute the PDF.' },
    { sourceFile:'apollo-sample-types.csv',contentType:'text/csv',label:'Apollo sample-type dataset - table transcription',description:'Five rows transcribed from page 1, Table 1 of the attached NASA PDF. Values are preserved as printed.',textContent:csv },
   ]) await upload(harness,state.id,file)
   assert.equal((await harness.callTool('list_attachments',{identifier:state.id})).attachments.length,4)
  })
  state.phase = 'draft_assets'
 } else if (phase === 'published' || phase === 'revised') {
  const isRevision = phase === 'revised'
  const html = await (await status(url,200)).text(), markdown = await (await status(url+'.md',200)).text()
  assert.match(html,/Apollo samples: why evidence needs more than a photograph/)
  assert.match(html,/associatedMedia/);assert.match(html,/<link rel="canonical" href="http:\/\/127\.0\.0\.1:5180\/publications\//)
  assert.ok(!html.includes('PRIVATE_DRAFT_REVIEW_20261022'));assert.ok(!markdown.includes('PRIVATE_DRAFT_REVIEW_20261022'))
  assert.match(markdown,/Original NASA technical paper/);assert.match(markdown,/ROCK,30,66/)
  assert.match(markdown,/http:\/\/127\.0\.0\.1:5180\/__publication-local\/media\//)
  const published = await (await status(`${web}/content/articles/${state.slug}`,200)).json()
  assert.equal(published.article.id,state.id);assert.equal(published.article.metadata.attachments.length,4)
  for (const asset of state.assets) {
    if (isRevision && asset.sourceFile === 'apollo-sample-types.csv') await privateFile(asset)
    else await liveFile(asset)
  }
  assert.ok((await (await status(`${web}/sitemap.xml`,200)).text()).includes(state.slug))
  assert.match((await (await status(`${web}/robots.txt`,200)).text()),/Sitemap:/)
  if (isRevision) {
   assert.match(markdown,/Revision 2: provenance and rounding/)
   assert.match(markdown,/source_table,source_page,source_url/)
   await privateRoutes(state.revisionSlug)
  }
  await writeFile(resolve(directory,`${phase}.html`),html);await writeFile(resolve(directory,`${phase}.md`),markdown)
  receipt('Published page, Markdown, metadata, canonical, sitemap and associated assets agree', { phase, url })
  state.phase = phase
 } else if (phase === 'revision-upload') {
  assert.ok(state.revisionId)
  await privateRoutes(state.revisionSlug)
  await withHarness(async harness => {
   const csv = await readFile(resolve(directory,'assets/apollo-sample-types-v2.csv'),'utf8')
   await upload(harness,state.revisionId,{sourceFile:'apollo-sample-types-v2.csv',contentType:'text/csv',label:'Apollo sample-type dataset with source provenance',description:'Same five source rows, now with source table, page and original URL on every row. Values remain unchanged.',textContent:csv})
   const prior = state.assets.find(asset=>asset.sourceFile==='apollo-sample-types.csv')
   await harness.callTool('detach_media',{identifier:state.revisionId,attachmentId:prior.attachmentId})
  })
  const liveMarkdown = await (await status(url+'.md',200)).text()
  assert.equal(liveMarkdown,await readFile(resolve(directory,'published.md'),'utf8'))
  assert.ok(!liveMarkdown.includes('Revision 2: provenance and rounding'))
  await liveFile(state.assets.find(asset=>asset.sourceFile==='apollo-sample-types.csv'))
  await privateFile(state.assets.find(asset=>asset.sourceFile==='apollo-sample-types-v2.csv'))
  receipt('Private revision leaves the live article and original dataset unchanged; replacement dataset stays private')
  state.phase='revision_private'
 } else if (phase === 'withdrawn') {
  await privateRoutes();await privateRoutes(state.revisionSlug)
  for(const asset of state.assets)await privateFile(asset)
  const original = await (await status(`${web}/content/articles/local-stabilization-verification`,200)).json()
  assert.equal(hash(JSON.stringify(original.article)),state.originalArticleDigest)
  await withHarness(async harness=>{
   const {article}=await harness.callTool('get_article',{identifier:state.id,includeContent:true})
   assert.equal(article.status,'draft');assert.equal(article.metadata.attachments.length,4)
   await writeFile(resolve(directory,'final-private-article.json'),JSON.stringify(article,null,2)+'\n')
  })
  receipt('Withdrawal removes HTML, Markdown, discovery and every file; original publication is unchanged and tested content remains a private draft')
  state.phase='withdrawn';state.completedAt=new Date().toISOString()
 } else throw new Error('Use upload, published, revision-upload, revised or withdrawn after the corresponding explicit MCP action.')
 await save()
 console.log(JSON.stringify({phase:state.phase,id:state.id,url,files:state.assets.map(asset=>({file:asset.sourceFile,bytes:asset.sizeBytes})),checks:checks.length}))
} catch(error) { state.failure={phase,message:error.message,at:new Date().toISOString()};await save();throw error }
