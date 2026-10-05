
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fail } from "./errors.mjs";

function ipv4Number(ip) { return ip.split(".").reduce((value,part)=>(value<<8)+Number(part),0)>>>0; }
function inRange(ip,base,bits) { const mask=bits===0?0:(0xffffffff << (32-bits))>>>0; return (ipv4Number(ip)&mask)===(ipv4Number(base)&mask); }
// Conservative public-address policy. IPv6 is parsed numerically, never by textual
// prefix: expanded and IPv4-mapped spellings must not bypass the boundary.
function ipv6Number(address) {
  let text = address.toLowerCase();
  if (text.includes(".")) {
    const index = text.lastIndexOf(":");
    const ipv4 = ipv4Number(text.slice(index + 1));
    text = `${text.slice(0, index)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 65535).toString(16)}`;
  }
  const [left, right] = text.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const groups = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  return groups.reduce((number, group) => (number << 16n) | BigInt(`0x${group}`), 0n);
}
function ipv6InRange(number, base, bits) {
  const shift = 128n - BigInt(bits);
  return (number >> shift) === (ipv6Number(base) >> shift);
}
export function isBlockedIp(address) {
  const family = isIP(address);
  if (family === 4) return [
    ["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
    ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],
    ["192.88.99.0",24],["192.168.0.0",16],["198.18.0.0",15],
    ["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]
  ].some(([base,bits]) => inRange(address,base,bits));
  if (family === 6) {
    const number = ipv6Number(address);
    // Reject mapped IPv4, NAT64, link-local, loopback, ULA, multicast and
    // unallocated space. Transition/documentation ranges within global space
    // are excluded too. This intentionally conservatively rejects uncertain addresses.
    if (!ipv6InRange(number, "2000::", 3)) return true;
    return [["2001::",23],["2001:db8::",32],["2002::",16],["3fff::",20]]
      .some(([base,bits]) => ipv6InRange(number,base,bits));
  }
  return true;
}
function hostMatches(host,pattern) { return host===pattern || (pattern.startsWith("*.") && host.endsWith(pattern.slice(1)) && host!==pattern.slice(2)); }
export async function resolveSafeTarget(raw,options={}) {
  let url; try { url=new URL(raw); } catch { fail("INVALID_URL","Integration URL is invalid"); }
  if (!['http:','https:'].includes(url.protocol)) fail("UNSAFE_PROTOCOL","Only HTTP and HTTPS are allowed");
  if (url.username||url.password) fail("URL_CREDENTIALS","Credentials must not be embedded in a URL");
  if (url.hash) url.hash="";
  const hostname=url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/,"");
  if (!hostname||hostname==="localhost"||hostname.endsWith(".localhost")) fail("BLOCKED_HOST","Local hostnames are blocked");
  const deny=options.denyHosts??[]; if (deny.some((p)=>hostMatches(hostname,p))) fail("BLOCKED_HOST","Host is denied by policy",{hostname});
  const allow=options.allowHosts??[]; if (allow.length>0&&!allow.some((p)=>hostMatches(hostname,p))) fail("HOST_NOT_ALLOWED","Host is absent from the connector allowlist",{hostname});
  const port=url.port?Number(url.port):(url.protocol==='https:'?443:80);
  const allowedPorts=options.allowedPorts??[80,443]; if (!allowedPorts.includes(port)) fail("PORT_NOT_ALLOWED","Port is not allowed",{port});
  const resolver=options.resolve??(async(host)=>dnsLookup(host,{all:true,verbatim:true}));
  let answers;
  if (isIP(hostname)) answers=[{address:hostname,family:isIP(hostname)}]; else { try { answers=await resolver(hostname); } catch(e) { fail("DNS_FAILURE","DNS resolution failed",{hostname,cause:e?.code??"UNKNOWN"}); } }
  if (!Array.isArray(answers)||answers.length===0) fail("DNS_EMPTY","DNS returned no addresses",{hostname});
  const normalized=answers.map((answer,index)=>{
    if (!answer || typeof answer.address!=="string") {
      fail("INVALID_RESOLVED_ADDRESS","DNS returned an invalid address",{hostname,index});
    }
    const detectedFamily=isIP(answer.address);
    const family=answer.family??detectedFamily;
    if (detectedFamily===0 || ![4,6].includes(family) || family!==detectedFamily) {
      fail("INVALID_RESOLVED_ADDRESS","DNS returned an invalid address",{hostname,index});
    }
    return {address:answer.address,family};
  });
  if (!options.allowPrivateForTest&&normalized.some((a)=>isBlockedIp(a.address))) fail("BLOCKED_ADDRESS","Target resolves to a non-public address",{hostname});
  normalized.sort((a,b)=>a.address.localeCompare(b.address));
  return Object.freeze({url,hostname,port,addresses:Object.freeze(normalized)});
}
