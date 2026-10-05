import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mintContinuationToken,authenticateContinuationRequest,createExactSessionTransport } from "../src/approval-continuation-transport.mjs";
const secret="fixture-secret-is-never-a-live-credential-012345";
const fixed=Date.parse("2026-09-15T10:00:00Z");
const claim={id:"continuation-1",leaseToken:"lease-1",leaseExpiresAt:new Date(fixed+60000),sessionId:"child-1",rootSessionId:"root-1",runId:"run-1",callId:"call-1",approvalId:"approval-1",payloadDigest:"a".repeat(64),versionId:"version-1",requestId:"native-1",decision:"approve",authority:{userId:"author",agentId:"agent-1",versionId:"version-1",authenticator:"crm-user",principalType:"user"}};
const body={inputResponses:[{requestId:"native-1",optionId:"approve"}]};
function request({token=mintContinuationToken(claim,secret,fixed),path="/eve/v1/session/child-1",payload=body,method="POST",headers={}}={}){
  return new Request(`https://agent.example${path}`,{method,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...headers},...(method==="POST"?{body:JSON.stringify(payload)}:{})});
}
test("continuation token admits only the exact session/decision body and preserves principal",async()=>{
 let n=0;const q=request();const auth=await authenticateContinuationRequest(q,secret,async c=>{n++;assert.equal(c.callId,"call-1");return c.authority;},()=>fixed);
 assert.equal(auth.principalId,"author");assert.equal(auth.attributes.runId,"run-1");assert.equal(n,1);
 assert.deepEqual(await q.json(),body); // middleware did not consume the native body
});
test("session/create/general token, altered body, verb, signature and time are rejected before admission",async()=>{
 for(const options of [{path:"/eve/v1/session"},{path:"/eve/v1/session/other"},{path:"/eve/v1/session/child-1?reset=true"},{payload:{message:"execute everything"}},
  {payload:{inputResponses:[{requestId:"native-1",optionId:"deny"}]}},{method:"GET"},{token:"bad.token.signature"},{headers:{"content-encoding":"gzip"}}]){
    const auth=await authenticateContinuationRequest(request(options),secret,async()=>assert.fail("must not admit"),()=>fixed);assert.equal(auth,null);
 }
 assert.equal(await authenticateContinuationRequest(request(),secret,async()=>assert.fail(),()=>fixed+60000),null);
 assert.equal(await authenticateContinuationRequest(request(),"different-secret-but-long-enough-000000",async()=>assert.fail(),()=>fixed),null);
});
test("bounded authentication rejects oversized and malicious JSON without creating consent",async()=>{
 const huge=request({payload:{inputResponses:body.inputResponses,pad:"x".repeat(20000)}});
 assert.equal(await authenticateContinuationRequest(huge,secret,async()=>assert.fail(),()=>fixed),null);
 assert.equal(await authenticateContinuationRequest(request(),secret,async()=>null,()=>fixed),null);
});
test("expired token during bounded body processing does not enter admission",async()=>{
 let n=0;const auth=await authenticateContinuationRequest(request(),secret,async()=>assert.fail(),()=>n++?fixed+60000:fixed);assert.equal(auth,null);
});
test("transport sends one exact ID request on a real loopback HTTP server, never a new session",async()=>{
 let hits=0;
 const server=createServer(async(req,res)=>{hits++;let raw="";for await(const chunk of req)raw+=chunk;
   assert.equal(req.url,"/eve/v1/session/child-1");assert.deepEqual(JSON.parse(raw),body);
   res.writeHead(202,{"content-type":"application/json","x-eve-session-id":"child-1"});res.end('{"sessionId":"child-1"}');});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{const send=createExactSessionTransport({baseUrl:`http://127.0.0.1:${server.address().port}`,secret,clock:()=>fixed});assert.deepEqual(await send(claim),{sessionId:"child-1"});assert.equal(hits,1);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test("transport rejects untrusted origins, redirects/errors, mismatched acknowledgement and never retries",async()=>{
 for(const url of ["http://external.example","https://u:p@agent.example","https://agent.example/base","https://agent.example/?x=1"])
   assert.throws(()=>createExactSessionTransport({baseUrl:url,secret}));
 let calls=0;const send=createExactSessionTransport({baseUrl:"https://agent.example",secret,clock:()=>fixed,fetchImpl:async(_u,opts)=>{calls++;assert.equal(opts.redirect,"error");return new Response("{}",{status:503});}});
 await assert.rejects(send(claim));assert.equal(calls,1);
 const wrong=createExactSessionTransport({baseUrl:"https://agent.example",secret,clock:()=>fixed,fetchImpl:async()=>new Response('{"sessionId":"wrong"}',{status:200})});await assert.rejects(wrong(claim));
});
