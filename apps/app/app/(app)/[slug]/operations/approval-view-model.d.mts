export function mayDecideApproval(row:unknown,decision:string,now?:number):boolean;
export function approvalDecisionPayload(row:unknown,decision:"APPROVED"|"REJECTED"|"CANCELLED",reason?:string,now?:number):{approvalId:string;expectedVersion:number;expectedDigest:string;decision:"APPROVED"|"REJECTED"|"CANCELLED";reason:string};
