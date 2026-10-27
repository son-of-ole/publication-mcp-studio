import assert from 'node:assert/strict'
import test from 'node:test'
import { S3Client } from '@aws-sdk/client-s3'
import { createNeonPublicationPlatform } from '../src/neon'
import { createSupabasePublicationPlatform } from '../src/supabase'
const payload = { articleSlug: 'draft', fileName: 'report.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-test'), kind: 'document' as const, embedMarkdown: '[Report](/draft/report.pdf)' }

test('Neon/S3 storage checks all public-access blocks, stores private object keys, and reads via the provider API', async t => {
 const original = S3Client.prototype.send
 t.after(() => { S3Client.prototype.send = original })
 let blocked = false, row: Record<string, unknown> | undefined
 const calls: string[] = []
 S3Client.prototype.send = (async function(command: any) {
   calls.push(command.constructor.name)
   if (command.constructor.name === 'GetPublicAccessBlockCommand') return { PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: blocked } }
   if (command.constructor.name === 'GetObjectCommand') return { ContentLength: payload.data.length, Body: { transformToWebStream: () => new ReadableStream({ start(controller) { controller.enqueue(payload.data);controller.close() } }) } }
   return {}
 }) as any
 const platform = createNeonPublicationPlatform({ sql: { query: async (sql: string, params: any[]) => {
  if (sql.includes('INSERT INTO publication_media_assets')) row={bucket:params[0],path:params[1],public_url:params[2],file_name:params[3],content_type:params[4],size_bytes:params[5],kind:params[6],article_slug:params[7],embed_markdown:params[8]}
  return { rows: row && sql.includes('SELECT') ? [row] : [] }
 } } as any, mediaStorage: { driver:'s3',bucket:'private-test-bucket',region:'us-east-1',accessKeyId:'test-only-id',secretAccessKey:'test-only-secret' } })
 await assert.rejects(()=>platform.mediaStore.uploadMedia(payload),{code:'private_bucket_required'})
 assert.ok(!calls.includes('PutObjectCommand'))
 blocked=true
 const asset=await platform.mediaStore.uploadMedia(payload)
 assert.match(asset.publicUrl,/^\/__publication-assets\/draft\//);assert.doesNotMatch(asset.publicUrl,/amazonaws/)
 assert.match(asset.embedMarkdown,/__publication-assets/)
 assert.deepEqual(Buffer.from(await platform.mediaStore.readMedia!(asset)),payload.data)
 assert.ok(calls.includes('GetObjectCommand'))
})

test('Supabase storage rejects a public bucket and serves private logical URLs without public provider URLs', async t => {
 const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY']
 const previous=keys.map(key=>process.env[key]), original=globalThis.fetch
 Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://storage.example.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test-only-anon',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-role'})
 t.after(()=>{globalThis.fetch=original;keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i]})})
 let isPublic=true,uploads=0
 globalThis.fetch=(async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
  if(url.pathname==='/storage/v1/bucket/article-assets')return Response.json({id:'article-assets',name:'article-assets',public:isPublic})
  if(init?.method==='POST' && url.pathname.startsWith('/storage/v1/object/article-assets/')){uploads++;return Response.json({Key:url.pathname})}
  if(url.pathname.startsWith('/storage/v1/object/info/'))return Response.json({name:'report.pdf',content_type:'application/pdf',size:payload.data.length})
  if(url.pathname.startsWith('/storage/v1/object/article-assets/'))return new Response(payload.data,{headers:{'content-type':'application/pdf'}})
  throw new Error('Unexpected provider request: '+url.pathname)
 }) as typeof fetch
 const store=createSupabasePublicationPlatform().mediaStore
 await assert.rejects(()=>store.uploadMedia(payload),{code:'private_bucket_required'});assert.equal(uploads,0)
 isPublic=false
 const asset=await store.uploadMedia(payload);assert.match(asset.publicUrl,/^\/__publication-assets\/draft\//)
 assert.match(asset.embedMarkdown,/__publication-assets/)
 const reread=await store.getMediaByPublicUrl!(asset.publicUrl);assert.equal(reread?.contentType,'application/pdf')
 assert.deepEqual(Buffer.from(await store.readMedia!(asset)),payload.data)
})
