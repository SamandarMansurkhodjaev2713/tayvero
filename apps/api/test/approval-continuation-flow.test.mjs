/** Real runtime + crypto + HTTP fixture, Prisma contract double. NOT Eve/PostgreSQL acceptance. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createPrismaApprovalLifecycle } from "@crm/agent-action-runtime";
import { createApprovalContinuationStore } from "@crm/agent-action-runtime/continuation";
import { createGovernedRunActionRuntime } from "../../agent/src/governed-run-action-runtime.mjs";
import { authenticateContinuationRequest, createExactSessionTransport } from "../../agent/src/approval-continuation-transport.mjs";
import { migrationPrismaDouble } from "./helpers/migration-prisma-double.mjs";

async function fixture({ loseAck = false } = {}) {
  const clock = () => new Date(); const secret = "fixture-only-bridge-not-a-real-secret-abcdefghijklmnopqrstuvwxyz";
  const f = migrationPrismaDouble({ member: [{ organizationId: "ws", userId: "author", role: "admin" }, { organizationId: "ws", userId: "reviewer", role: "owner" }],
    agentDefinition: [{ id:"agent",status:"LIVE" }], agentVersion: [{ id:"version",agentId:"agent",createdById:"author" }],
    agentRun: [{ id:"run",agentId:"agent",versionId:"version",initiatedById:"author",status:"RUNNING",sessionId:"root",startedAt:clock(),cancelRequestedAt:null,approvalWaitStartedAt:null }] });
  let effects = 0, deliveries = 0; const store = createApprovalContinuationStore({ prisma:f.db,workspaceId:"ws",clock });
  const runtime = createGovernedRunActionRuntime({ prisma:f.db,clock,approvalLifecycleWorkspaceId:"ws",
    loadTrustedContext:async ({ actionId,runId,callId }) => ({ tenantId:"ws",actorId:`agent-run:${runId}`,requestId:`action:${runId}:${callId}`,correlationId:"corr",permissions:[actionId] }),
    authorize:async () => f.state.agentRun[0].status === "RUNNING" && !f.state.agentRun[0].cancelRequestedAt,
    evaluatePolicy:async () => ({allowed:true,requiresApproval:true}),
    executeCrmActivity:async () => { throw new Error("Not used"); },
    executeSlackMessage:async () => {effects++;return{actionId:"crm-action",messageId:"fixture:1",destination:"#fixture",replayed:false};},
  });
  const request = { runId:"run",callId:"call",input:{text:"One approved message"} };
  const preflight = await runtime.prepareSlackMessage(request);
  assert.equal(effects,0);assert.equal(f.state.governedActionReceipt.length,0);
  const identity={runId:"run",callId:"call",sessionId:"child",toolName:"post_slack_message",approvalId:preflight.approvalId,payloadDigest:preflight.digest};
  const ticket = await store.prepare(identity);
  await store.bind({...identity,requestId:"native-call",turnId:"turn",sequence:1,eventId:"input"});
  await store.park({runId:"run",sessionId:"child",eventId:"waiting"});
  const lifecycle = createPrismaApprovalLifecycle({prisma:f.db,workspaceId:"ws",clock});
  const approval = f.state.governedActionApproval[0];
  await lifecycle.decide({tenantId:"ws",actorId:"reviewer"},{approvalId:approval.id,expectedVersion:approval.version,expectedDigest:approval.payloadDigest,decision:"APPROVED"});
  const server = createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const incoming=new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:req.headers,body:Buffer.concat(chunks)});
      const authority=await authenticateContinuationRequest(incoming,secret,q=>store.admitDelivery(q));
      if(!authority){res.writeHead(401).end();return;}
      assert.equal(req.url,"/eve/v1/session/child");assert.equal(authority.principalId,"author");deliveries++;
      assert.deepEqual(await incoming.json(),{inputResponses:[{requestId:"native-call",optionId:"approve"}]});
      await store.assertExecution(identity);
      await runtime.executeSlackMessage(request);
      // Simulate receipt committed but hook/transport acknowledgement lost, or normal observation.
      if(loseAck){res.destroy();return;}
      await store.observeSuccess(identity);
      res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({sessionId:"child"}));
    }catch(error){res.writeHead(500).end();throw error;}
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const transport=createExactSessionTransport({baseUrl:`http://127.0.0.1:${server.address().port}`,secret});
  return {...f,store,runtime,request,identity,ticket,transport,counts:()=>({effects,deliveries}),close:()=>new Promise(resolve=>server.close(resolve))};
}

test("approved native request traverses real governed executor once, then receipt completes continuation",async()=>{
  const f=await fixture();try{
    const done=await f.store.dispatch(f.ticket.id,f.transport);assert.equal(done.status,"COMPLETED");
    assert.deepEqual(f.counts(),{effects:1,deliveries:1});assert.equal(f.state.governedActionApproval[0].status,"CONSUMED");
    assert.equal(f.state.governedActionReceipt[0].status,"SUCCEEDED");
    await f.runtime.executeSlackMessage(f.request);assert.equal(f.counts().effects,1);
    assert.equal((await f.store.dispatch(f.ticket.id,f.transport)).status,"NOT_CLAIMED");
  }finally{await f.close();}
});
test("lost native acknowledgement is reconciled from actual runtime receipt without another HTTP request",async()=>{
  const f=await fixture({loseAck:true});try{
    assert.equal((await f.store.dispatch(f.ticket.id,f.transport)).status,"RECONCILIATION_REQUIRED");
    assert.deepEqual(f.counts(),{effects:1,deliveries:1});
    const restarted=createApprovalContinuationStore({prisma:f.db,workspaceId:"ws"});await restarted.candidates();
    assert.equal(f.state.governedActionContinuation[0].status,"COMPLETED");
    assert.equal((await restarted.dispatch(f.ticket.id,f.transport)).status,"NOT_CLAIMED");assert.deepEqual(f.counts(),{effects:1,deliveries:1});
  }finally{await f.close();}
});
