export type ContinuationClaim = Readonly<{
  id: string; leaseToken: string; leaseExpiresAt: Date; sessionId: string; rootSessionId: string;
  runId: string; callId: string; approvalId: string; payloadDigest: string; versionId: string;
  requestId: string; decision: "approve" | "deny";
  authority: Readonly<{ userId: string; agentId: string; versionId: string; authenticator: "crm-user"|"crm-schedule"; principalType: "user"|"runtime" }>;
}>;
export type ContinuationIdentity = Readonly<{ runId: string; sessionId: string; callId: string; payloadDigest: string }>;
export function createApprovalContinuationStore(options: {
  prisma: object; workspaceId: string; clock?: ()=>Date; deliveryLeaseMs?: number; executionBudgetMs?: number;
}): Readonly<{
  prepare(input: ContinuationIdentity & {toolName:string;approvalId:string}): Promise<{id:string;status:string;decision:"approve"|"deny"|null}>;
  bind(input: ContinuationIdentity & {requestId:string;turnId:string;sequence:number;eventId:string;toolName:string}):Promise<string>;
  park(input:{runId:string;sessionId:string;eventId:string}):Promise<boolean>;
  claim(id:string):Promise<ContinuationClaim|null>;
  admitDelivery(claim:ContinuationClaim):Promise<ContinuationClaim["authority"]|null>;
  settleDelivery(claim:ContinuationClaim,result:{acceptedSessionId?:string|null;errorCode?:string|null}):Promise<string>;
  dispatch(id:string,deliver:(claim:ContinuationClaim)=>Promise<{sessionId:string}>):Promise<{status:string}>;
  candidates():Promise<string[]>;
  assertExecution(identity:ContinuationIdentity):Promise<void>;
  observeSuccess(identity:ContinuationIdentity):Promise<boolean>;
}>;
