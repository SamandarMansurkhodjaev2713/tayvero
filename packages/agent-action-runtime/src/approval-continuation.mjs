import { boundRunPrincipal } from "./run-principal.mjs";
import { randomUUID } from "node:crypto";
import { sha256Hex, GovernedActionError } from "./index.mjs";

const ACTIVE = ["RUNNING", "WAITING_FOR_APPROVAL"];
const TERMINAL = ["SUCCEEDED", "FAILED", "CANCELLED"];
const OPEN = ["PREPARED", "BOUND", "READY", "DISPATCHING", "RECONCILIATION_REQUIRED"];
const TOOL_ACTIONS = Object.freeze({ create_crm_activity: "crm.activity.create", post_slack_message: "slack.message.post" });
const fail = (code, message) => { throw new GovernedActionError(code, message, { sideEffect: "NOT_STARTED" }); };
const id = value => { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(value)) fail("CONTINUATION_INPUT_INVALID", "Invalid continuation identity"); return value; };
const hash = value => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("CONTINUATION_INPUT_INVALID", "Invalid continuation digest"); return value; };
const date = value => { const at = new Date(value); if (!Number.isFinite(at.getTime())) fail("CONTINUATION_CLOCK_INVALID", "Invalid continuation clock"); return at; };

/** Durable native-HITL handoff. This store NEVER executes business actions or consumes consent.
 * Every transport call is outside the transaction and is attempted at most once per ticket.
 * No "exactly once" transport promise: lost acceptance is quarantined for reconciliation.
 */
export function createApprovalContinuationStore({ prisma, workspaceId, clock = () => new Date(),
  deliveryLeaseMs = 120000, executionBudgetMs = 1200000 } = {}) {
  id(workspaceId);
  if (!prisma?.$transaction || !Number.isSafeInteger(deliveryLeaseMs) || deliveryLeaseMs < 1000 || deliveryLeaseMs > 300000
      || !Number.isSafeInteger(executionBudgetMs) || executionBudgetMs < 1000 || executionBudgetMs > 86400000) {
    fail("CONTINUATION_CONFIG_INVALID", "Invalid continuation configuration");
  }
  const now = () => date(clock());
  async function transaction(fn) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await prisma.$transaction(fn, { isolationLevel: "Serializable", timeout: 15000 }); }
      catch (error) { if (!["P2034", "P2002"].includes(error?.code) || attempt === 2) throw error; }
    }
  }
  async function get(client, ticketId) {
    const row = await client.governedActionContinuation.findFirst({ where: { id: id(ticketId), workspaceId } });
    if (!row) fail("CONTINUATION_NOT_FOUND", "Continuation is unavailable in this workspace");
    return row;
  }
  async function runFor(client, row, allowInactive = false) {
    const run = await client.agentRun.findUnique({ where: { id: row.runId } });
    if (!run || run.versionId !== row.versionId || run.sessionId !== row.rootSessionId)
      fail("CONTINUATION_BINDING_MISMATCH", "Run version or root session changed");
    if (!allowInactive && (!ACTIVE.includes(run.status) || run.cancelRequestedAt))
      fail("CONTINUATION_RUN_INACTIVE", "Run is no longer active");
    return run;
  }
  async function approvalFor(client, row) {
    const approval = await client.governedActionApproval.findFirst({ where: { id: row.approvalId, workspaceId } });
    if (!approval || approval.bindingVersion !== 1 || approval.runId !== row.runId
        || approval.requestedById !== `agent-run:${row.runId}` || approval.payloadDigest !== row.payloadDigest
        || approval.actionId !== TOOL_ACTIONS[row.toolName]
        || approval.executionKeyHash !== sha256Hex(`${row.runId}:${row.callId}`)) {
      fail("CONTINUATION_BINDING_MISMATCH", "Consent no longer matches the exact action");
    }
    return approval;
  }
  async function principal(client, run, approval) {
    const version = await client.agentVersion.findUnique({ where: { id: run.versionId } });
    const agent = version && await client.agentDefinition.findUnique({ where: { id: version.agentId } });
    const userId = boundRunPrincipal(run,agent);
    const membership = userId && await client.member.findUnique({ where: { organizationId_userId: { organizationId: workspaceId, userId } } });
    if (!version || !agent || !["LIVE", "PAUSED"].includes(agent.status) || !membership
        || !["owner", "admin", "member"].includes(membership.role) || userId !== approval.requesterUserId) return null;
    return { userId, agentId: version.agentId, versionId: version.id,
      authenticator: run.initiatedById ? "crm-user" : "crm-schedule",
      principalType: run.initiatedById ? "user" : "runtime" };
  }
  async function audit(client, row, type, details = {}, eventId = null) {
    await client.governedActionAuditEvent.create({ data: {
      ...(eventId ? { id: `gc-event-${sha256Hex([workspaceId, row.sessionId, type, eventId]).slice(0,48)}` } : {}),
      workspaceId, actionId: TOOL_ACTIONS[row.toolName], actorId: `agent-run:${row.runId}`,
      requestId: row.id, correlationId: row.runId, eventType: type, payloadDigest: row.payloadDigest,
      detailsJson: { continuationId: row.id, nativeSessionId: row.sessionId, callId: row.callId, ...details }, occurredAt: now(),
    } });
  }
  async function cas(client, row, change) {
    const result = await client.governedActionContinuation.updateMany({ where: { id: row.id, workspaceId, version: row.version, status: row.status },
      data: { ...change, updatedAt: now(), version: { increment: 1 } } });
    if (result.count !== 1) fail("CONTINUATION_STALE", "Continuation changed concurrently");
    return { ...row, ...change, version: row.version + 1 };
  }
  async function seenEvent(client, row, type, eventId) {
    return !!await client.governedActionAuditEvent.findUnique({ where: { id: `gc-event-${sha256Hex([workspaceId,row.sessionId,type,eventId]).slice(0,48)}` }, select: { id: true } });
  }
  async function block(client, row, errorCode) {
    const next = await cas(client,row,{ status:"RECONCILIATION_REQUIRED", errorCode, leaseToken:null, leaseExpiresAt:null });
    await audit(client,next,"agent.continuation.uncertain",{errorCode});
    return next;
  }
  const service = {
    async prepare({ runId, sessionId, callId, toolName, approvalId, payloadDigest }) {
      [runId, sessionId, callId, approvalId].forEach(id); hash(payloadDigest);
      if (!Object.hasOwn(TOOL_ACTIONS, toolName)) fail("CONTINUATION_INPUT_INVALID", "Unsupported native tool");
      const ticketId = `gc_${sha256Hex([workspaceId,runId,callId]).slice(0,48)}`;
      return transaction(async client => {
        const run = await client.agentRun.findUnique({ where: { id: runId } });
        if (!run || !ACTIVE.includes(run.status) || run.cancelRequestedAt || !run.sessionId)
          fail("CONTINUATION_RUN_INACTIVE", "An active persisted root session is required");
        const row = { id: ticketId, workspaceId, runId, versionId: run.versionId, rootSessionId: run.sessionId, sessionId, callId, toolName, approvalId, payloadDigest };
        const approval = await approvalFor(client,row);
        if (!await principal(client,run,approval)) fail("CONTINUATION_FORBIDDEN", "Requesting authority is no longer current");
        const old = await client.governedActionContinuation.findFirst({ where: { id: ticketId,workspaceId } });
        if (old) {
          for (const key of Object.keys(row)) if (old[key] !== row[key]) fail("CONTINUATION_BINDING_MISMATCH", "Native call identity was reused with different bindings");
          return { id: old.id, status: old.status, decision: old.decision };
        }
        if (run.status !== "RUNNING") fail("CONTINUATION_RUN_INACTIVE", "Cannot add a new tool while the run is parked");
        const count = await client.governedActionContinuation.count({where:{workspaceId,runId,OR:[{status:{in:OPEN}},{status:"DELIVERED",decision:"approve"}]}});
        if (count >= 50) fail("CONTINUATION_QUEUE_LIMIT","Too many unfinished native approvals");
        const saved = await client.governedActionContinuation.create({data:{...row,status:"PREPARED",version:0,
          nativeRequestId:null,nativeTurnId:null,nativeSequence:null,decision:null,leaseToken:null,leaseExpiresAt:null,
          transportAdmittedAt:null,nextCheckAt:now(),waitingAt:null,deliveredAt:null,completedAt:null,errorCode:null,createdAt:now(),updatedAt:now()}});
        await audit(client,saved,"agent.continuation.prepared");
        return { id:saved.id,status:saved.status,decision:null };
      });
    },
    async bind({runId,sessionId,callId,requestId,turnId,sequence,eventId,payloadDigest,toolName}) {
      [runId,sessionId,callId,requestId,turnId,eventId].forEach(id); hash(payloadDigest);
      if (!Number.isSafeInteger(sequence) || sequence < 0) fail("CONTINUATION_INPUT_INVALID","Invalid native sequence");
      const ticketId=`gc_${sha256Hex([workspaceId,runId,callId]).slice(0,48)}`;
      const result = await transaction(async client=>{
        const row=await get(client,ticketId); await runFor(client,row);
        if(row.sessionId!==sessionId || row.payloadDigest!==payloadDigest || row.toolName!==toolName)
          fail("CONTINUATION_BINDING_MISMATCH","Native request differs from approved tool input/session");
        await approvalFor(client,row);
        if(row.nativeRequestId) {
          if(row.nativeRequestId!==requestId || row.nativeTurnId!==turnId || row.nativeSequence!==sequence) {
            if (!TERMINAL.includes((await runFor(client,row,true)).status) && row.status !== "COMPLETED")
              await block(client,row,"CONTINUATION_NATIVE_REQUEST_CHANGED");
            return { identityConflict: true };
          }
          return row.id;
        }
        if(row.status!=="PREPARED") fail("CONTINUATION_STALE","Cannot bind this continuation state");
        const next=await cas(client,row,{status:"BOUND",nativeRequestId:requestId,nativeTurnId:turnId,nativeSequence:sequence});
        await audit(client,next,"agent.continuation.bound",{requestId,turnId,sequence},eventId); return row.id;
      });
      // Throw only AFTER the quarantine transaction commits.
      if (typeof result !== "string") fail("CONTINUATION_NATIVE_REQUEST_CHANGED","Native approval identity changed; reconciliation is required");
      return result;
    },
    async park({runId,sessionId,eventId}) {
      [runId,sessionId,eventId].forEach(id);
      return transaction(async client=>{
        const rows=await client.governedActionContinuation.findMany({where:{workspaceId,runId,sessionId,status:{in:["BOUND","READY"]}},take:51});
        if(!rows.length) return false;
        if(rows.length>50) fail("CONTINUATION_QUEUE_LIMIT","Invalid native approval queue");
        const first=rows[0];
        if(await seenEvent(client,first,"agent.continuation.parked",eventId)) return false;
        const run=await runFor(client,first);
        const at=now();
        for(const row of rows) if(row.status==="BOUND") await cas(client,row,{status:"READY",waitingAt:at,nextCheckAt:at});
        const deadline=run.approvalExecutionDeadlineAt ?? new Date(date(run.startedAt).getTime()+executionBudgetMs);
        const changed=await client.agentRun.updateMany({where:{id:run.id,status:run.status,versionId:run.versionId,sessionId:run.sessionId,cancelRequestedAt:null},
          data:{status:"WAITING_FOR_APPROVAL",approvalWaitStartedAt:run.approvalWaitStartedAt??at,approvalExecutionDeadlineAt:deadline}});
        if(changed.count!==1) fail("CONTINUATION_RUN_INACTIVE","Run changed before native waiting was recorded");
        await audit(client,first,"agent.continuation.parked",{},eventId); return true;
      });
    },
    async claim(ticketId) {
      return transaction(async client=>{
        let row=await get(client,ticketId);
        if(row.status!=="READY") return null;
        const run=await runFor(client,row,true);
        if(TERMINAL.includes(run.status)||run.cancelRequestedAt){await cas(client,row,{status:"CANCELLED",completedAt:now()}); await audit(client,row,"agent.continuation.cancelled");return null;}
        if(run.status!=="WAITING_FOR_APPROVAL" || !run.approvalWaitStartedAt) return null;
        // One in-flight delivery for the whole run, including child sessions.
        if(await client.governedActionContinuation.findFirst({where:{workspaceId,runId:run.id,status:{in:["DISPATCHING","RECONCILIATION_REQUIRED"]}},select:{id:true}})) return null;
        const approval=await approvalFor(client,row);
        let at=now();
        if(approval.status==="PENDING" && date(approval.expiresAt)>at){await cas(client,row,{nextCheckAt:new Date(at.getTime()+60000)});return null;}
        if(approval.status==="CONSUMED") {await block(client,row,"CONSENT_ALREADY_CONSUMED");return null;}
        if(!["PENDING","APPROVED","REJECTED","EXPIRED","CANCELLED"].includes(approval.status)){await block(client,row,"CONSENT_STATE_UNKNOWN");return null;}
        const authority=await principal(client,run,approval);
        if(!authority){await block(client,row,"REQUESTER_AUTHORITY_REVOKED");return null;}
        const approver=approval.approvedById && await client.member.findUnique({where:{organizationId_userId:{organizationId:workspaceId,userId:approval.approvedById}}});
        at=now();
        const decision=approval.status==="APPROVED" && date(approval.expiresAt)>at && approval.snapshotJson?.previewComplete===true
          && approval.approvedById!==authority.userId && ["owner","admin"].includes(approver?.role) ? "approve" : "deny";
        const waited=at.getTime()-date(run.approvalWaitStartedAt).getTime();
        const oldDeadline=date(run.approvalExecutionDeadlineAt ?? new Date(date(run.startedAt).getTime()+executionBudgetMs));
        if(oldDeadline<=date(run.approvalWaitStartedAt) || waited<0 || at.getTime()-date(run.startedAt).getTime()>7*86400000){await block(client,row,"RUN_WAIT_BUDGET_INVALID");return null;}
        const updated=await client.agentRun.updateMany({where:{id:run.id,status:"WAITING_FOR_APPROVAL",versionId:run.versionId,sessionId:row.rootSessionId,cancelRequestedAt:null,approvalWaitStartedAt:run.approvalWaitStartedAt},
          data:{status:"RUNNING",approvalWaitStartedAt:null,approvalExecutionDeadlineAt:new Date(oldDeadline.getTime()+waited)}});
        if(updated.count!==1) fail("CONTINUATION_STALE","Another dispatcher resumed this run");
        row=await cas(client,row,{status:"DISPATCHING",decision,leaseToken:randomUUID(),leaseExpiresAt:new Date(at.getTime()+deliveryLeaseMs),errorCode:null});
        await audit(client,row,"agent.continuation.dispatch_started",{decision});
        return {id:row.id,leaseToken:row.leaseToken,leaseExpiresAt:row.leaseExpiresAt,sessionId:row.sessionId,
          rootSessionId:row.rootSessionId,runId:row.runId,callId:row.callId,approvalId:row.approvalId,payloadDigest:row.payloadDigest,
          versionId:row.versionId,requestId:row.nativeRequestId,decision,authority};
      });
    },
    async admitDelivery(claim) {
      return transaction(async client=>{
        const row=await get(client,claim.id);
        if(row.status!=="DISPATCHING" || row.leaseToken!==claim.leaseToken || row.transportAdmittedAt
          || row.sessionId!==claim.sessionId || row.nativeRequestId!==claim.requestId || row.decision!==claim.decision
          || row.runId!==claim.runId || row.callId!==claim.callId || row.versionId!==claim.versionId
          || row.payloadDigest!==claim.payloadDigest || row.approvalId!==claim.approvalId || row.rootSessionId!==claim.rootSessionId
          || date(row.leaseExpiresAt)<=now()) return null;
        const run=await runFor(client,row);
        const approval=await approvalFor(client,row);
        const current=await principal(client,run,approval);
        if(!current || current.userId!==claim.authority.userId || current.agentId!==claim.authority.agentId
          || current.versionId!==claim.authority.versionId || current.authenticator!==claim.authority.authenticator
          || current.principalType!==claim.authority.principalType) return null;
        if(row.decision==="approve") {
          const approver=approval.approvedById && await client.member.findUnique({where:{organizationId_userId:{organizationId:workspaceId,userId:approval.approvedById}}});
          if(approval.status!=="APPROVED" || approval.snapshotJson?.previewComplete!==true || approval.approvedById===current.userId
            || !["owner","admin"].includes(approver?.role) || date(approval.expiresAt)<=now()) return null;
        }
        const at=now(); if(date(row.leaseExpiresAt)<=at || row.decision === "approve" && date(approval.expiresAt)<=at) return null;
        const next=await cas(client,row,{transportAdmittedAt:at});
        await audit(client,next,"agent.continuation.transport_admitted");
        return current;
      });
    },
    async settleDelivery(claim,{acceptedSessionId=null,errorCode=null}={}) {
      return transaction(async client=>{
        const row=await get(client,claim.id);
        if(row.status==="COMPLETED") return row.status; // an authoritative receipt can beat HTTP acknowledgement
        if(row.status!=="DISPATCHING" || row.leaseToken!==claim.leaseToken) return row.status;
        if(errorCode || acceptedSessionId!==row.sessionId || date(row.leaseExpiresAt)<=now()) {
          await block(client,row,errorCode?"DELIVERY_OUTCOME_UNKNOWN":acceptedSessionId!==row.sessionId?"NATIVE_SESSION_MISMATCH":"DELIVERY_LEASE_EXPIRED");
          return "RECONCILIATION_REQUIRED";
        }
        const next=await cas(client,row,{status:"DELIVERED",deliveredAt:now(),leaseToken:null,leaseExpiresAt:null});
        await audit(client,next,"agent.continuation.delivered",{decision:row.decision}); return "DELIVERED";
      });
    },
    async dispatch(ticketId,deliverExactSession) {
      if(typeof deliverExactSession!=="function") fail("CONTINUATION_CONFIG_INVALID","Exact-session transport is required");
      const claim=await service.claim(ticketId); if(!claim)return {status:"NOT_CLAIMED"};
      let accepted;
      try { accepted=await deliverExactSession(claim); }
      catch { return {status:await service.settleDelivery(claim,{errorCode:"TRANSPORT_UNKNOWN"})}; }
      // If this commit fails, the lease sweeper quarantines. Never resend because an ACK was lost.
      return {status:await service.settleDelivery(claim,{acceptedSessionId:accepted?.sessionId})};
    },
    async candidates() {
      const stale=await prisma.governedActionContinuation.findMany({where:{workspaceId,status:"DISPATCHING",leaseExpiresAt:{lte:now()}},orderBy:[{leaseExpiresAt:"asc"},{id:"asc"}],take:20});
      for(const item of stale) await transaction(async client=>{const row=await get(client,item.id);if(row.status==="DISPATCHING"&&date(row.leaseExpiresAt)<=now())await block(client,row,"DELIVERY_LEASE_EXPIRED");});
      const observed=await prisma.governedActionContinuation.findMany({where:{workspaceId,status:{in:["DELIVERED","RECONCILIATION_REQUIRED"]},decision:"approve",nextCheckAt:{lte:now()}},orderBy:[{nextCheckAt:"asc"},{id:"asc"}],take:20});
      for(const item of observed) {
        const done=await service.observeSuccess(item);
        if(!done) await transaction(async client=>{const row=await get(client,item.id);if(["DELIVERED","RECONCILIATION_REQUIRED"].includes(row.status))await cas(client,row,{nextCheckAt:new Date(now().getTime()+60000)});});
      }
      const rows=await prisma.governedActionContinuation.findMany({where:{workspaceId,status:"READY",nextCheckAt:{lte:now()}},orderBy:[{nextCheckAt:"asc"},{id:"asc"}],take:20,select:{id:true}});
      return rows.map(row=>row.id);
    },
    async assertExecution({runId,sessionId,callId,payloadDigest}) {
      [runId,sessionId,callId].forEach(id); hash(payloadDigest);
      const unresolved=await prisma.governedActionContinuation.findFirst({where:{workspaceId,runId,status:"RECONCILIATION_REQUIRED"},select:{id:true}});
      if(unresolved) fail("CONTINUATION_REQUIRES_RECONCILIATION","Native delivery is uncertain; no new side effects may run");
      const row=await prisma.governedActionContinuation.findFirst({where:{workspaceId,runId,callId}});
      if(!row) {
        const pending=await prisma.governedActionContinuation.findFirst({where:{workspaceId,runId,OR:[
          {status:{in:["PREPARED","BOUND","READY","DISPATCHING"]}}, {status:"DELIVERED",decision:"approve"},
        ]},select:{id:true}});
        if(pending)fail("CONTINUATION_EXECUTION_BLOCKED","Resolve the existing exact action before proposing new side effects");
        return; // action did not need approval; executor still enforces current policy
      }
      await runFor(prisma,row);
      if(row.sessionId!==sessionId||row.payloadDigest!==payloadDigest||row.decision!=="approve"||!row.transportAdmittedAt||!["DISPATCHING","DELIVERED","COMPLETED"].includes(row.status))
        fail("CONTINUATION_EXECUTION_BLOCKED","Only the same approved native call may continue");
    },
    async observeSuccess({runId,sessionId,callId,payloadDigest}) {
      [runId,sessionId,callId].forEach(id);hash(payloadDigest);
      return transaction(async client=>{
        const row=await client.governedActionContinuation.findFirst({where:{workspaceId,runId,callId}});if(!row)return false;
        if(row.sessionId!==sessionId||row.payloadDigest!==payloadDigest)fail("CONTINUATION_BINDING_MISMATCH","Result identity differs");
        if(row.status==="COMPLETED")return true;
        if(!["DISPATCHING","DELIVERED","RECONCILIATION_REQUIRED"].includes(row.status)||row.decision!=="approve")return false;
        const receipt=await client.governedActionReceipt.findFirst({where:{workspaceId,actionId:TOOL_ACTIONS[row.toolName],idempotencyKey:`${workspaceId}:${TOOL_ACTIONS[row.toolName]}:${runId}:${callId}`,payloadDigest,status:"SUCCEEDED"},select:{id:true}});
        if(!receipt) return false;
        const next=await cas(client,row,{status:"COMPLETED",completedAt:now(),leaseToken:null,leaseExpiresAt:null,errorCode:null});
        await audit(client,next,"agent.continuation.action_observed");return true;
      });
    },
  };
  return Object.freeze(service);
}
