import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express, { type Request, type Response } from 'express'
import { once } from 'node:events'
import { createEngineSecurity, validateProductionEngine } from '../src/security.js'
import { createExpressSupabasePublicationAdminAuthStore, runWithPublicationAdminRequestContext } from '../src/publication-lib/publication-admin-express.js'
import { verifyPublicationMarkdown } from '../src/publication-lib/publication-verifiers.js'
import { importPublicationDocument } from '../src/publication-lib/publication-import-export.js'

test('Supabase admin authorization fails closed and is bound to verified immutable IDs; cookies enforce origin',async()=>{
 const verified={id:'listed-owner',email:'owner@example.invalid'}, verifyUser=async()=>verified
 const req=(headers:any={},method='GET')=>({cookies:{'sb-access-token':'valid-provider-token'},headers,method,protocol:'http',get:(name:string)=>name==='host'?'engine.local':headers[name]}) as unknown as Request
 const run=(request:Request,fn:()=>any)=>runWithPublicationAdminRequestContext(request,{clearCookie(){}} as unknown as Response,fn)
 const denied=createExpressSupabasePublicationAdminAuthStore({verifyUser,adminUserIds:[]})
 assert.equal(await run(req(),()=>denied.getCurrentUser()),null)
 const store=createExpressSupabasePublicationAdminAuthStore({verifyUser,adminUserIds:['listed-owner']})
 assert.equal((await run(req(),()=>store.getCurrentUser()))?.id,'listed-owner')
 const unlisted=createExpressSupabasePublicationAdminAuthStore({verifyUser:async()=>({...verified,id:'ordinary-user'}),adminUserIds:['listed-owner']})
 assert.equal(await run(req(),()=>unlisted.getCurrentUser()),null)
 await assert.rejects(()=>run(req({origin:'https://evil.invalid'},'POST'),()=>store.getCurrentUser()),{status:403})
 assert.equal((await run(req({authorization:'Bearer valid-provider-token',origin:'https://evil.invalid'},'POST'),()=>store.getCurrentUser()))?.id,'listed-owner')
 await assert.rejects(()=>run(req({origin:'https://evil.invalid'},'POST'),()=>store.signOut()),{status:403})
})
test('Lean/proof content is structurally inspected without ever invoking a host executable',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'pub-lean-disabled-')); t.after(()=>rm(root,{recursive:true,force:true}))
 const marker=path.join(root,'executed');await writeFile(path.join(root,'lean'),`#!/bin/sh\necho executed > '${marker}'\n`,{mode:0o700})
 const previous=process.env.PATH;process.env.PATH=root+path.delimiter+previous;t.after(()=>{process.env.PATH=previous})
 for(const markdown of ['::lean{code="example : True := by trivial"}','::proof{code="example : True := by trivial"}']) {
  const r=await verifyPublicationMarkdown(markdown,'lean');assert.equal(r.status,'unavailable');assert.ok(r.findings.some(f=>f.code==='lean_execution_isolated_worker_required'))
 }
 await assert.rejects(()=>access(marker),{code:'ENOENT'})
 assert.equal((await verifyPublicationMarkdown('Plain text','lean')).status,'pass')
 assert.equal((await verifyPublicationMarkdown('::lean{title="Missing code"}','lean')).findings.some(f=>f.code==='lean_code_missing'),true)
})
test('text import remains usable; binary and oversized imports fail before parser execution',async()=>{
 assert.match((await importPublicationDocument({fileName:'article.md',data:Buffer.from('# Draft\n\nSafe content')})).markdown,/Safe content/)
 await assert.rejects(()=>importPublicationDocument({fileName:'article.pdf',data:Buffer.from('test')}),{code:'isolated_import_worker_required'})
 await assert.rejects(()=>importPublicationDocument({fileName:'article.docx',data:Buffer.from('test')}),{code:'isolated_import_worker_required'})
 await assert.rejects(()=>importPublicationDocument({fileName:'large.md',data:new Uint8Array(8*1024*1024+1)}),{status:413})
})
test('engine limiter expires windows, rejects browser origins, and provides retry information',async t=>{
 let time=0; const app=express();app.use(createEngineSecurity({now:()=>time,windowMs:1000,max:5,loginMax:2}));app.all('/admin/login',(_req,res)=>res.json({ok:true}))
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections()}));const origin=`http://127.0.0.1:${(server.address() as any).port}`
 assert.equal((await fetch(origin+'/admin/login',{headers:{origin:'https://evil.invalid'}})).status,403)
 for(let i=0;i<2;i++)assert.equal((await fetch(origin+'/admin/login')).status,200)
 const limited=await fetch(origin+'/admin/login');assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'1')
 time=1001;assert.equal((await fetch(origin+'/admin/login')).status,200)
})
test('production engine refuses weak/missing configuration and unscoped wildcard credentials',()=>{
 const valid={NODE_ENV:'production',PUBLICATION_PLATFORM_ADAPTER:'neon',PUBLICATION_ENGINE_ORIGIN:'https://engine.example.invalid',PUBLICATION_API_SECRET:'test-only-secret-with-at-least-32-characters',PUBLICATION_ADMIN_PASSWORD:'test-only-long-password'}
 assert.doesNotThrow(()=>validateProductionEngine(valid))
 for(const env of [{...valid,PUBLICATION_API_SECRET:'weak'},{...valid,PUBLICATION_ENGINE_ORIGIN:'http://engine.invalid'},{...valid,PUBLICATION_API_TOKEN:'wildcard'},{...valid,PUBLICATION_PLATFORM_ADAPTER:'local'}])assert.throws(()=>validateProductionEngine(env))
})

test('local engine lock refuses a second owner and releases only its own lock', async t => {
 const { acquireLocalEngineLock } = await import('../src/local-lock.js')
 const root=await mkdtemp(path.join(tmpdir(),'pub-engine-lock-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const release=await acquireLocalEngineLock(root)
 await assert.rejects(()=>acquireLocalEngineLock(root),/Local engine lock exists/)
 await release()
 const next=await acquireLocalEngineLock(root);await next()
})
