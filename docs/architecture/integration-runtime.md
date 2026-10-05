# Integration runtime

R11 implements an outbound boundary rather than arbitrary model-controlled HTTP. Every target is protocol/host/port checked, DNS-resolved, private and metadata ranges are blocked, and the request is pinned to a validated address while TLS still verifies the original hostname. Redirects are revalidated. Requests are bounded by body size, response size, a wall-clock deadline, redirect count and retry count. Mutation retry requires a stable provider idempotency key.

## Address pinning

The connection uses a custom DNS lookup callback backed only by the already validated address. Node 22 may request custom lookup results with `{ all: true }`; the runtime supports both the array and scalar callback contracts and disables automatic family reselection. This prevents the transport from silently resolving the hostname again after the SSRF policy check.

Resolver output is validated before socket creation:

- address must be a syntactically valid IPv4 or IPv6 literal;
- declared family must match the address;
- every resolved address is checked against private, loopback, link-local, metadata, documentation, multicast and reserved ranges;
- redirect targets repeat the complete validation process.

The local contract suite covers address-pinned execution, malformed resolver output, redirect-to-private denial and a slow-trickle response that must still terminate at the total deadline.

## Incoming and schema-derived integrations

Incoming webhooks use timestamped HMAC verification, constant-time comparison and replay claims. OpenAPI documents are accepted as data only; external references are rejected and operations become typed manifests, never automatically executable unrestricted tools.

Live proxy, DNS, OAuth and provider verification remain deployment-specific gates.
