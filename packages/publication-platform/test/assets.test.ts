import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { createLocalPublicationPlatform, createPublicationFetchHandler, createPublicationAssetTools, createPublicPublicationFetchHandler, createPublishedMediaFetchHandler, issuePublicationToken, PUBLICATION_UPLOAD_CHUNK_BYTES, runPublicationMcpStdio } from '../src/index'
import { createPublicationClient, PUBLICATION_AGENT_SCOPES } from '../../publication-client/src/index'
import type { PublicationAuthContext } from '../src/types'
const actor: PublicationAuthContext = { tokenType: 'signed', tokenId: 'test', label: 'agent', scopes: [...PUBLICATION_AGENT_SCOPES], enabledSkillIds: [] }
async function fixture(t: test.TestContext) {
 const root = await mkdtemp(path.join(tmpdir(), 'pub-assets-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const platform = createLocalPublicationPlatform({rootDir:root, seedDemoContent:false})
 const handler = createPublicationFetchHandler({platform,basePath:'/api/publications',tokenSecrets:['test-only-signing-secret']})
 const issuedAt=new Date().toISOString(), expiresAt=new Date(Date.now()+3600000).toISOString()
 const record=await platform.tokenStore.createTokenRecord({label:'agent',scopes:[...PUBLICATION_AGENT_SCOPES],issuedAt,expiresAt})
 const token=issuePublicationToken({tokenId:record.id,secret:'test-only-signing-secret',scopes:record.scopes,issuedAt,expiresAt}).token
 const client=createPublicationClient({origin:'http://engine.invalid',token,fetch:(async(url,init)=>handler(new Request(String(url),init))) as typeof fetch})
 return {platform,handler,client,token}
}
test('portable MCP + typed client: multi-megabyte PDF/image/data, structured attachments, crawlable HTML/Markdown, private revision and withdrawal',async t=>{
 const {platform,client}=await fixture(t)
 const created=await client.createArticle({title:'Publication with supporting evidence',slug:'evidence',body:'## Results\n\nThe complete article.'}),id=created.article.id
 const pdf=Buffer.alloc(1500000,32);pdf.write('%PDF-1.4\n%%EOF\n')
 const publicPage=createPublicPublicationFetchHandler({store:platform.publicationStore,mediaStore:platform.mediaStore,siteUrl:'https://public.example'})
 const read=(path:string)=>publicPage(new Request('https://public.example'+path))
 const assets=[]
 for (const [fileName,contentType,data,label,textContent] of [
   ['evidence.pdf','application/pdf',pdf,'Evidence PDF','Extracted evidence supplied by the harness.'],
   ['figure.png','image/png',Buffer.from([137,80,78,71,13,10,26,10]),'Results figure',''],
   ['data.csv','text/csv',Buffer.from('year,value\n2026,42\n'),'Source dataset','year,value\n2026,42'],
 ] as const) {
   const {asset}=await client.uploadMedia({identifier:id,fileName,contentType,data});assets.push(asset)
   assert.equal((await read(asset.publicUrl))?.status,404)
   await client.attachMedia(id,{url:asset.publicUrl,label,description:'Public supporting material',textContent})
 }
 assert.equal((await client.listAttachments(id)).attachments.length,3)
 assert.equal((await read('/publications/evidence.md'))?.status,404)
 const tools=(await client.listTools()).result.tools.map(x=>x.name)
 assert.ok(tools.includes('begin_media_upload'));assert.ok(tools.includes('publish_article'));assert.ok(!tools.includes('delete_article'))
 await assert.rejects(()=>client.deleteArticle(id),{status:403})
 await client.publishArticle(id)
 const html=await (await read('/publications/evidence'))!.text(), md=await (await read('/publications/evidence.md'))!.text()
 assert.match(html,/Extracted evidence supplied by the harness/);assert.match(html,/associatedMedia/)
 assert.match(md,/https:\/\/public.example\/__publication-local\/media\/evidence/);assert.match(md,/2026,42/)
 const response=(await read(assets[0].publicUrl))!;assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(response.headers.get('content-disposition')!,/^attachment/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf)
 await assert.rejects(()=>client.attachMedia(id,{url:assets[0].publicUrl}),{status:409})
 const revision=(await client.createRevision(id)).article
 const review=await client.preparePublication(revision.id)
 await client.detachMedia(revision.id,(await client.listAttachments(revision.id)).attachments[0].id)
 await assert.rejects(()=>client.publishRevision(revision.id,review.digest),{status:409})
 assert.equal((await read(assets[0].publicUrl))?.status,200)
 const approved=await client.preparePublication(revision.id);await client.publishRevision(revision.id,approved.digest)
 assert.equal((await read(assets[0].publicUrl))?.status,404);assert.equal((await read(assets[1].publicUrl))?.status,200)
 await client.unpublishArticle(id)
 for (const route of ['/publications/evidence','/publications/evidence.md',...assets.map(asset=>asset.publicUrl)])assert.equal((await read(route))?.status,404)
 assert.doesNotMatch(await (await read('/sitemap.xml'))!.text(),/\/publications\/evidence/)
})
test('staged uploads bind identity, enforce ordered bounded chunks, retry safely, expire and verify integrity',async t=>{
 const {platform,client}=await fixture(t);const id=(await client.createArticle({title:'Draft',slug:'draft',body:'Private'})).article.id
 let now=0; const execute=createPublicationAssetTools(platform,{now:()=>now})
 const bytes=Buffer.alloc(PUBLICATION_UPLOAD_CHUNK_BYTES+1,7),sha256=createHash('sha256').update(bytes).digest('hex')
 const begin=()=>execute('begin_media_upload',{identifier:id,fileName:'evidence.pdf',sizeBytes:bytes.length,sha256},actor,'one')
 const first:any=await begin()
 await assert.rejects(()=>execute('upload_media_chunk',{uploadId:first.uploadId,index:0,dataBase64:'!!!!'},actor,'one'),{code:'invalid_base64'})
 await assert.rejects(()=>execute('complete_media_upload',{uploadId:first.uploadId},actor,'two'),{code:'upload_not_found'})
 await assert.rejects(()=>execute('upload_media_chunk',{uploadId:first.uploadId,index:1,dataBase64:bytes.subarray(0,1).toString('base64')},actor,'one'),{code:'chunk_out_of_order'})
 const chunk={uploadId:first.uploadId,index:0,dataBase64:bytes.subarray(0,PUBLICATION_UPLOAD_CHUNK_BYTES).toString('base64')}
 assert.deepEqual(await execute('upload_media_chunk',chunk,actor,'one'),await execute('upload_media_chunk',chunk,actor,'one'))
 await assert.rejects(()=>execute('complete_media_upload',{uploadId:first.uploadId},actor,'one'),{code:'upload_incomplete'})
 await execute('upload_media_chunk',{uploadId:first.uploadId,index:1,dataBase64:bytes.subarray(-1).toString('base64')},actor,'one')
 const completed=await execute('complete_media_upload',{uploadId:first.uploadId},actor,'one')
 assert.deepEqual(await execute('complete_media_upload',{uploadId:first.uploadId},actor,'one'),completed)
 const bad:any=await begin();await execute('upload_media_chunk',{uploadId:bad.uploadId,index:0,dataBase64:Buffer.alloc(PUBLICATION_UPLOAD_CHUNK_BYTES,1).toString('base64')},actor,'one');await execute('upload_media_chunk',{uploadId:bad.uploadId,index:1,dataBase64:'AQ=='},actor,'one')
 await assert.rejects(()=>execute('complete_media_upload',{uploadId:bad.uploadId},actor,'one'),{code:'checksum_mismatch'})
 const expired:any=await begin();now=15*60000
 await assert.rejects(()=>execute('complete_media_upload',{uploadId:expired.uploadId},actor,'one'),{code:'upload_not_found'})
 await assert.rejects(()=>execute('begin_media_upload',{identifier:id,fileName:'../escape',sizeBytes:1,sha256},actor,'one'),{code:'invalid_file_name'})
 await assert.rejects(()=>execute('begin_media_upload',{identifier:id,fileName:'huge.pdf',sizeBytes:8*1024*1024+1,sha256},actor,'one'),{status:413})
 for(let i=0;i<8;i++)await execute('begin_media_upload',{identifier:id,fileName:'large.pdf',sizeBytes:8*1024*1024,sha256},actor,'one')
 await assert.rejects(begin,{code:'upload_capacity'})
})
test('attachments cannot claim another article namespace; media ignores bearer authority and rejects writes',async t=>{
 const {platform,client}=await fixture(t)
 const first=(await client.createArticle({title:'First',slug:'first',body:'Draft'})).article.id, second=(await client.createArticle({title:'Second',slug:'second',body:'Draft'})).article.id
 const asset=(await client.uploadMedia({identifier:first,fileName:'private.txt',data:Buffer.from('private')})).asset
 await assert.rejects(()=>client.attachMedia(second,{url:asset.publicUrl}),{status:404})
 await assert.rejects(()=>client.attachMedia(first,{url:'https://evil.invalid/file.pdf'}),{status:404})
 const media=createPublishedMediaFetchHandler(platform)
 assert.equal((await media(new Request('https://public.invalid'+asset.publicUrl,{headers:{authorization:'Bearer owner'}}))).status,404)
 assert.equal((await media(new Request('https://public.invalid'+asset.publicUrl,{method:'POST'}))).status,405)
})
test('stdio transport handles fragmented JSON-RPC, suppresses notifications and never emits credentials',async()=>{
 const input=new PassThrough(),output=new PassThrough(),chunks:Buffer[]=[];output.on('data',chunk=>chunks.push(chunk))
 const operation=runPublicationMcpStdio({url:'http://127.0.0.1:8080/api/publications/mcp',getAuthorization:async()=> 'Bearer test-only-private',input,output,fetch:(async(_url,init)=>{
  assert.equal(new Headers(init?.headers).get('authorization'),'Bearer test-only-private')
  const data=JSON.parse(String(init?.body)); return data.id===undefined?new Response(null,{status:204}):Response.json({jsonrpc:'2.0',id:data.id,result:{ok:true}})
 }) as typeof fetch})
 input.write('{"jsonrpc":"2.0","id":1,');input.write('"method":"ping"}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');input.end('invalid\n')
 await operation
 const text=Buffer.concat(chunks).toString(),lines=text.trim().split('\n').map(line=>JSON.parse(line))
 assert.equal(lines.length,2);assert.equal(lines[0].result.ok,true);assert.equal(lines[1].error.code,-32700);assert.doesNotMatch(text,/test-only-private/)
})

test('stdio preserves correlated engine conflict errors while rejecting mismatched response IDs',async()=>{
 const input=new PassThrough(),output=new PassThrough(),chunks:Buffer[]=[];output.on('data',chunk=>chunks.push(chunk))
 const operation=runPublicationMcpStdio({url:'http://127.0.0.1:8080/api/publications/mcp',getAuthorization:async()=> 'Bearer test-only-private',input,output,fetch:(async(_url,init)=>{
  const request=JSON.parse(String(init?.body))
  return Response.json({jsonrpc:'2.0',id:request.id===1?1:999,error:{code:-32000,message:'Revision changed since review.',data:{code:'revision_changed',status:409}}},{status:409})
 }) as typeof fetch})
 input.end('{"jsonrpc":"2.0","id":1,"method":"tools/call"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call"}\n')
 await operation
 const responses=Buffer.concat(chunks).toString().trim().split('\n').map(line=>JSON.parse(line))
 assert.equal(responses[0].id,1);assert.equal(responses[0].error.data.code,'revision_changed');assert.equal(responses[0].error.data.status,409)
 assert.equal(responses[1].id,2);assert.equal(responses[1].error.data,undefined);assert.match(responses[1].error.message,/engine request failed/i)
})
