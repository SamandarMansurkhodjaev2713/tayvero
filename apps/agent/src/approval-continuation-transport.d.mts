import type { ContinuationClaim } from "@crm/agent-action-runtime/continuation";
export function mintContinuationToken(claim:ContinuationClaim,secret:string,at?:number):string;
export function authenticateContinuationRequest(request:Request,secret:string,admit:(claim:ContinuationClaim)=>Promise<ContinuationClaim["authority"]|null>,at?:()=>number):Promise<{
 authenticator:"crm-user"|"crm-schedule"; principalType:"user"|"runtime"; principalId:string; attributes:Record<string,string>;
}|null>;
export function createExactSessionTransport(options:{baseUrl:string;secret:string;fetchImpl?:typeof fetch;clock?:()=>number;timeoutMs?:number}):(claim:ContinuationClaim)=>Promise<{sessionId:string}>;
