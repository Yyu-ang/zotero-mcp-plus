# Remote ChatGPT MCP via optional OAuth

This implementation follows the built-in OAuth flow in
[Yyu-ang/coding-tools-mcp](https://github.com/Yyu-ang/coding-tools-mcp/blob/main/docs/remote-mcp.md).
Cloudflare Tunnel transports HTTPS only; no Cloudflare Access service or third-party auth server is required.

## Configure Zotero

1. The **Allow remote access** checkbox controls the local listener on the configured **MCP server port** (default `23120`) exactly as it does without OAuth: unchecked keeps it on loopback, checked binds `0.0.0.0` for LAN clients. That listener never asks for a token, so only check it on a network you trust. Point the Cloudflare Tunnel at the OAuth listener instead (next step), never at this port.
2. Configure Cloudflare Tunnel to forward `https://zotero.example.com` to `http://127.0.0.1:<oauth-port>` on the *same machine* — the **authenticated** listener, default `23121`. That listener only exists while both **Allow remote access** and **OAuth authorization** are enabled; with either switch off, the port is closed. Do **not** point the tunnel at `<mcp-port>` (default `23120`): that listener serves clients without a token. Replace the example hostname with your own.

   Other Zotero plugins bind fixed ports too, and the OS may hand a shared port to the other plugin, leaving this listener unreachable. If `curl http://127.0.0.1:<oauth-port>/.well-known/oauth-protected-resource` does not return this plugin's JSON, set an explicit **OAuth port** in the preferences (e.g. `23221`) and point the tunnel at that port.
3. Under Zotero MCP preferences, enter `https://zotero.example.com` as the **public HTTPS origin** (without `/mcp`).
4. Click **Generate / rotate authorization password**. The password is kept in Zotero's local password manager, so **Show password** and **Copy password** keep working after a restart — the plugin preferences store only its salted SHA-256 digest. Rotating the password invalidates existing authorizations.
5. Enable **OAuth authorization**. Leave the existing write operations disabled when only reading a literature library.
6. In a ChatGPT workspace that permits custom remote MCP, connect the Streamable HTTP URL `https://zotero.example.com/mcp`. Use OAuth, and enter the generated password on the authorization page.

Do not forward either port through router port forwarding, and enable **Allow remote access** only on a network you trust: `<mcp-port + 1>` always requires a bearer token, but `<mcp-port>` never does. The public endpoint must be HTTPS. If the public origin or password changes, existing OAuth sessions and client registrations are invalidated.

## Supported endpoints

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `POST /oauth/register` (dynamic client registration)
- `GET /oauth/authorize`, `POST /oauth/authorize` (password login + S256 PKCE)
- `POST /oauth/token` (`authorization_code`, opaque Bearer token, 24-hour TTL)

Authorization codes expire after 5 minutes and are single-use; pending codes are held in memory, so an interrupted consent restarts rather than resumes. Client registrations, opaque access tokens and rotating refresh tokens persist in the `oauth.persistentState` preference, bound to the configured public origin and the current password digest: a normal Zotero restart keeps them valid, while changing the origin or the password revokes every client and session. Refresh tokens live 30 days and rotate on every use.

OAuth is disabled by default. When it is enabled but incompletely configured, the MCP endpoint fails closed (HTTP 401). Unauthenticated MCP calls return a `WWW-Authenticate: Bearer` challenge with a resource metadata link. OAuth endpoints are unauthenticated as required for client registration and sign-in; `/ping` remains a public health check.

## Smoke checks

```bash
BASE=https://zotero.example.com
curl -i "$BASE/.well-known/oauth-protected-resource"
curl -i "$BASE/.well-known/oauth-authorization-server"
curl -i -X POST "$BASE/mcp" -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# Without a valid OAuth access token the last call MUST return HTTP 401.
```

### Automated end-to-end check

`scripts/verify-oauth.mjs` exercises the full flow against a running Zotero: discovery metadata, anonymous and forged-token rejection, unsafe-redirect rejection, dynamic registration, the authorize page, wrong-password refusal, password login, code exchange, an authenticated `tools/list` call, and single-use code replay rejection. It never prints the password and exits non-zero on the first failed expectation.

```bash
node scripts/verify-oauth.mjs --password <authorization password> [--base http://127.0.0.1:23120]
```

Do not publish the login password or an access token in Git, screenshots, logs, or public discussions.
