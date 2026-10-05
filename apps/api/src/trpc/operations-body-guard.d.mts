import type {IncomingMessage,ServerResponse} from "node:http";
export function createOperationsBodyGuard(options?:{maxBytes?:number;timeoutMs?:number;maxConcurrent?:number}):(request:IncomingMessage & {body?:unknown},response:ServerResponse,next:()=>void)=>void;
