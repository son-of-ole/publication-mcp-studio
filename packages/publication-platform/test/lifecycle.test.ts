import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLocalPublicationPlatform, createPublicationFetchHandler, createPublicationRevision, preparePublication, publishPublicationRevision, publicationContentDigest, issuePublicationToken, backupLocalPublications, restoreLocalPublications, readPublicationBytes } from '../src/index'
import { createNeonPublicationPlatform } from '../src/neon'
import type { PublicationAuthContext, PublicationArticleRecord } from '../src/types'
const owner: PublicationAuthContext = { tokenType: 'static', label: 'owner', scopes: ['*'], enabledSkillIds: [] }
const writer: PublicationAuthContext = { ...owner, scopes: ['articles:read', 'articles:write', 'mcp:connect'] }
const record = (): PublicationArticleRecord => ({ id: '11111111-2222-4333-8444-555555555555', title: 'Live', slug: 'live', status: 'published', contentMarkdown: 'Original live edition', metadata: {}, category: null, tags: [], createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z' })
async function fixture(t: test.TestContext) {
 const root = await mkdtemp(path.join(tmpdir(), 'pub-foundation-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 return { root, platform:createLocalPublicationPlatform({rootDir:root,seedDemoContent:false}) }
}
test('private revision review binds exact content, rejects stale review/base and publishes atomically', async t=>{
 const {platform}=await fixture(t); const store=platform.publicationStore; await store.createArticle(record())
 const draft=await createPublicationRevision(store,'live',writer)
 assert.equal(draft.status,'draft'); assert.notEqual(draft.slug,'live')
 await store.updateArticle(draft.id,{contentMarkdown:'Private proposed edition'})
 const before=await preparePublication(store,draft.id,writer)
 assert.equal((await store.getArticleByIdentifier('live'))?.contentMarkdown,'Original live edition')
 await assert.rejects(()=>publishPublicationRevision(store,draft.id,before.digest,writer),{code:'insufficient_scope'})
 await store.updateArticle(draft.id,{contentMarkdown:'Changed after review'})
 await assert.rejects(()=>publishPublicationRevision(store,draft.id,before.digest,owner),{code:'revision_changed'})
 const reviewed=await preparePublication(store,draft.id,owner)
 const results=await Promise.allSettled([publishPublicationRevision(store,draft.id,reviewed.digest,owner),publishPublicationRevision(store,draft.id,reviewed.digest,owner)])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 const live=await store.getArticleByIdentifier('live'); assert.equal(live?.contentMarkdown,'Changed after review'); assert.equal(live?.slug,'live'); assert.equal(live?.metadata.publicationRevision,undefined)
 assert.equal((await store.getArticleByIdentifier(draft.id))?.status,'draft')
 await assert.rejects(()=>publishPublicationRevision(store,draft.id,reviewed.digest,owner),{code:'publication_changed'})
 assert.equal(publicationContentDigest({...live!,metadata:{b:2,a:1}}),publicationContentDigest({...live!,metadata:{a:1,b:2}}))
})
test('SDK REST and MCP enforce publication permissions and execute portable draft/revision flow',async t=>{
 const {platform}=await fixture(t),secret='test-only-secret'
 const issue=async(scopes:any)=>{const issuedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString();const r=await platform.tokenStore.createTokenRecord({label:'test',scopes,issuedAt,expiresAt});return issuePublicationToken({tokenId:r.id,scopes,issuedAt,expiresAt,secret}).token}
 const ownerToken=await issue(['mcp:connect','articles:read','articles:write','articles:publish','articles:delete']), writerToken=await issue(writer.scopes)
 const handler=createPublicationFetchHandler({platform,tokenSecrets:[secret]})
 const req=(url:string,method='GET',body?:unknown,token=writerToken)=>handler(new Request('http://engine.invalid/publications'+url,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}))
 assert.equal((await req('/articles','POST',{title:'Denied',slug:'denied',status:'published'})).status,403)
 const created=await (await req('/articles','POST',{title:'Draft',slug:'draft',body:'Private draft'})).json()
 const id=created.article.id
 assert.equal((await req('/articles/'+id,'PATCH',{status:'published'})).status,403)
 assert.equal((await req('/articles/'+id+'/publish','POST',{},ownerToken)).status,200)
 assert.equal((await req('/articles/'+id,'PATCH',{body:'Unauthorized live edit'})).status,403)
 assert.equal((await req('/articles/'+id,'PATCH',{body:'Accidental owner live edit'},ownerToken)).status,409)
 assert.equal((await req('/articles/'+id+'/unpublish','POST')).status,403)
 const rpc=async(name:string,args:unknown,token=ownerToken)=>{const r=await req('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},token);assert.equal(r.status,200);const data=await r.json();assert.ok(!data.result.isError,JSON.stringify(data));return data.result.structuredContent}
 const init=await (await req('/mcp','POST',{jsonrpc:'2.0',id:0,method:'initialize'})).json(); assert.equal(init.result.serverInfo.name,'publication-mcp-studio')
 const list=await(await req('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/list'})).json();assert.ok(list.result.tools.some((t:any)=>t.name==='create_revision'));assert.ok(!list.result.tools.some((t:any)=>t.name==='publish_revision'))
 const {article:draft}=await rpc('create_revision',{identifier:id},writerToken)
 await rpc('update_article',{identifier:draft.id,body:'Reviewed new edition'},writerToken)
 const prepared=await rpc('prepare_publication',{identifier:draft.id},writerToken)
 await rpc('publish_revision',{identifier:draft.id,expectedDigest:prepared.digest})
 assert.equal((await platform.publicationStore.getArticleByIdentifier(id))?.contentMarkdown,'Reviewed new edition')
 assert.equal((await req('/articles','POST',{title:'x',slug:'x',body:'x'.repeat(1024*1024)})).status,413)
 assert.equal((await req('/articles','POST',null)).status,400)
 await assert.rejects(()=>platform.publicationStore.createArticle({...record(),slug:'draft'}),{code:'article_conflict'})
})
test('no-op revision publication is one-shot and withdrawal/republication invalidates pending approvals',async t=>{
 const {platform}=await fixture(t), store=platform.publicationStore
 await store.createArticle(record())
 const noop=await createPublicationRevision(store,'live',owner), first=await preparePublication(store,noop.id,owner)
 await publishPublicationRevision(store,noop.id,first.digest,owner)
 await assert.rejects(()=>publishPublicationRevision(store,noop.id,first.digest,owner),{code:'publication_changed'})
 const pending=await createPublicationRevision(store,'live',owner)
 const review=await preparePublication(store,pending.id,owner)
 const handler=createPublicationFetchHandler({platform,staticTokens:['owner']})
 for(const action of ['unpublish','publish']) assert.equal((await handler(new Request('http://engine/publications/articles/live/'+action,{method:'POST',headers:{authorization:'Bearer owner'}}))).status,200)
 await assert.rejects(()=>publishPublicationRevision(store,pending.id,review.digest,owner),{code:'publication_changed'})
})
test('conditional Neon publication compares all content in one UPDATE and returns conflicts without timestamp rounding',async()=>{
 const calls:{sql:string;params:unknown[]}[]=[]
 const platform=createNeonPublicationPlatform({sql:{query:async(sql:string,params:unknown[])=>{calls.push({sql,params});return {rows:[]}}} as any})
 assert.equal(await platform.publicationStore.updateArticleIfMatches!(record(),{contentMarkdown:'New'}),null)
 const update=calls.find(c=>c.sql.includes('UPDATE articles'))!; assert.match(update.sql,/metadata=\$5::jsonb/);assert.match(update.sql,/content_markdown=\$4/);assert.match(update.sql,/category IS NOT DISTINCT FROM/);assert.doesNotMatch(update.sql,/WHERE.*updated_at=/);assert.ok(update.params.includes('Original live edition'));assert.ok(update.params.includes('New'))
})
test('encrypted local backup roundtrips drafts/media, rejects tampering and refuses existing restore roots',async t=>{
 const {root,platform}=await fixture(t); await platform.publicationStore.createArticle({...record(),status:'draft'})
 const asset=await platform.mediaStore.uploadMedia({articleSlug:'live',fileName:'figure.txt',contentType:'text/plain',data:Buffer.from('Private media'),kind:'other',embedMarkdown:''})
 const issuedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString();const prior=await platform.tokenStore.createTokenRecord({label:'pre-backup token',scopes:['articles:read'],issuedAt,expiresAt})
 const file=path.join(root,'test.publication-backup'),passphrase='test-only-backup-passphrase-at-least-twenty'
 const receipt=await backupLocalPublications({rootDir:root,destination:file,passphrase});assert.equal(receipt.articles,1);assert.equal((await stat(file)).mode&0o777,0o600);assert.doesNotMatch(await readFile(file,'utf8'),/Original live edition|Private media/)
 const target=path.join(root,'restored'); await assert.rejects(()=>restoreLocalPublications({backupFile:file,destinationRoot:target,passphrase:'incorrect-test-passphrase'}))
 await restoreLocalPublications({backupFile:file,destinationRoot:target,passphrase})
 const recovered=createLocalPublicationPlatform({rootDir:target,seedDemoContent:false});assert.equal((await recovered.publicationStore.getArticleByIdentifier('live'))?.status,'draft');assert.ok((await recovered.tokenStore.getTokenRecord(prior.id))?.revokedAt);assert.equal(await readFile(path.join(target,'public',asset.publicUrl),'utf8'),'Private media')
 await assert.rejects(()=>restoreLocalPublications({backupFile:file,destinationRoot:target,passphrase}),{code:'EEXIST'})
 const envelope=JSON.parse(await readFile(file,'utf8')); envelope.tag=Buffer.alloc(16).toString('base64');await writeFile(file,JSON.stringify(envelope));await assert.rejects(()=>restoreLocalPublications({backupFile:file,destinationRoot:path.join(root,'tampered'),passphrase}))
})
test('streamed byte limits reject chunked responses without trusting Content-Length',async()=>{
 let canceled=false; const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(5));c.enqueue(new Uint8Array(5))},cancel(){canceled=true}})
 await assert.rejects(()=>readPublicationBytes(stream,8),{code:'payload_too_large'});assert.equal(canceled,true)
})

test('concurrent first readers cannot reseed and erase a newly written article', async t => {
 const {platform}=await fixture(t), store=platform.publicationStore
 await Promise.all([store.createArticle({...record(),status:'draft'}),...Array.from({length:20},()=>store.listArticles())])
 assert.equal((await store.getArticleByIdentifier('live'))?.contentMarkdown,'Original live edition')
})
