# Remote MCP with optional OAuth

## Entry points and switches

Authentication is attached to the accepted listener, never inferred from Host,
source IP or forwarded headers. The ordinary MCP port P (default 23120) is
unauthenticated. The OAuth port Q (default P+1 = 23121; configurable) requires a
Bearer token for MCP. Discovery, consent, registration, token exchange and the
exact `/ping` health endpoint have their documented protocol exceptions.

| Allow remote access | Enable OAuth | P | Q |
|---|---|---|---|
| off | off | loopback, no authentication | closed |
| off | on | loopback, no authentication | closed |
| on | off | all interfaces, no authentication | closed |
| on | on | all interfaces, no authentication | all interfaces, OAuth |

**All-interface binding is not a LAN-only ACL.** Restrict P to trusted LAN hosts
using the host firewall. Never port-forward P, publish it through a tunnel, or
make it reachable on a public interface. Configure the public HTTPS tunnel to
forward **only to Q**, normally `http://127.0.0.1:23121` on the same host. This
plugin does not create a tunnel, DNS record, TLS certificate or firewall rule.
Untrusted LAN users can read/use P without a token; keep write tools disabled
unless deliberately required.

While OAuth is enabled, P rejects requests with common proxy markers (`cf-ray`,
`cf-connecting-ip`, `cdn-loop`, `x-forwarded-for`, `forwarded`) with HTTP 403 and a
wrong-entry-point hint. This is denial-only defense in depth, **not proof that a
request without those headers is local**. A proxy can strip headers. Q never
accepts a request merely because a forwarded header claims a local address.

## Setup

1. Enable the MCP server. Keep P=23120 or choose a valid ordinary port.
2. Set the public HTTPS **origin**, e.g. `https://zotero.example.com`, without `/mcp`.
3. Generate a high-entropy authorization password, or set a strong unique one.
   It is stored in the profile Login Manager; preferences keep the salted digest.
4. Set Q or leave it blank for P+1. Q must differ from P. With P=65535, choose an
   explicit valid Q. An OAuth bind failure is reported without stopping P.
5. Enable both **Allow remote access** and **OAuth authorization**. Restrict P to
   trusted LAN hosts in the host firewall, and publish only Q through HTTPS.
6. Configure the remote client with `https://zotero.example.com/mcp` and OAuth.
   Check the prominently displayed callback host on the consent page before
   authorizing. Consent is protected against framing.

Fixed clients configured from preferences are operator-managed, may be imported
from an authorize URL, and persist without a live token. Importing is a local
configuration action, not a remote auto-registration feature. Dynamic client
registration remains available. Callbacks are exact-match, at most three URIs,
each at most 512 UTF-8 bytes; use HTTPS except for HTTP loopback callbacks.

## State and revocation

Access tokens last 24 hours; rotating refresh tokens last 30 days. Only digests
are persisted. Registrations with live tokens and operator-managed fixed clients
survive a normal restart. Unused dynamic registrations stay in memory, expire
after 30 minutes, and are evicted first at capacity; active clients and pending
codes are protected. Anonymous registration does not rewrite preferences.

The bounded JSON state remains in `oauth.persistentState`, capped at 768 KiB.
The public origin is length-limited, callbacks and grants are bounded, and restored
objects are reconstructed from validated fields. Moving storage to a data-directory
JSON file is a possible follow-up, not part of this beta.

Changing origin or password revokes previous authorizations. Saving an unchanged
password repairs the vault entry without rotating it. Disabling OAuth revokes
grants and dynamic registrations; fixed client settings remain for reauthorization.
Authorization codes are single-use, process-local, and expire after 5 minutes.
Replayed codes revoke the issuing client's tokens while the consumed-code record
is retained. Refresh replay detection persists a bounded history of the latest
256 consumed refresh tokens; replay revokes that client's current grants. This is
bounded detection, not an unbounded token-family audit log.

Registration is globally limited to 60 attempts per minute; failed password login
is limited to 10 per minute. HTTP 429 includes Retry-After. These limits do not
trust caller-supplied IP headers. They reduce abuse but cannot prevent every
availability attack against a publicly accessible local process.

## Endpoints and checks

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `POST /oauth/register`
- `GET` / `POST /oauth/authorize` (Authorization Code + S256 PKCE)
- `POST /oauth/token` (`authorization_code`, `refresh_token`)

```sh
curl -i https://zotero.example.com/.well-known/oauth-protected-resource
curl -i -X POST https://zotero.example.com/mcp -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# The unauthenticated public MCP request MUST return 401, never a tool result.
```

The live regression script defaults to `http://127.0.0.1:23121`:
`node scripts/verify-oauth.mjs --password <password> --base <Q URL>`.
Command-line secrets may be visible in process lists or shell history; run only
in an appropriate trusted environment and never paste credentials into logs or
public reviews. This script requires a real running Zotero; Node unit tests do not
replace the live check.
