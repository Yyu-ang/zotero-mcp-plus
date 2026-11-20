# Zotero MCP Plus 1.7.0-plus-beta.1

Integrated beta based on upstream v1.7.0 (`fad02b8641fe0c04ced4d8d2038339c9c0975692`) and the latest pushed fork beta.6 (`dd6d06b82d205f180439f2c81d162f4bafb79307`). Published only to **Yyu-ang/zotero-mcp-plus**, not upstream.

## Highlights

- Fixes semantic keyword/hybrid relevance, transactional collection saving, six-locale Fluent integration, runtime disable behavior, stale searches and safe snippet highlighting.
- Retains manual OAuth passwords, fixed clients and configurable authenticated port; hardens registration limits, persistence, revocation, consent and listener cleanup.
- Preserves entry-point authentication: ordinary MCP port 23120 has no authentication; OAuth port 23121 (or configured Q) protects MCP. Both remote-access and OAuth switches are required for Q. Remote-access off keeps P on loopback and Q closed.
- Retains fork citation-file and external-tool features while incorporating upstream v1.7.0. Citation-file tools remain gated by their preference.
- Includes two isolated review-candidate branches; no upstream review replies were posted.

## Security / migration

**Restrict unauthenticated P to trusted LAN hosts using the firewall. All-interface binding is not a LAN-only ACL. Never publish or port-forward P. Public HTTPS tunnels must target Q.** Proxy-marker rejection on P is defense in depth, not an authentication boundary. Existing unusually long or numerous callbacks may need re-registration under the new limits (3 callbacks, 512 UTF-8 bytes each). Disabling OAuth revokes existing grants.

Refresh replay tracking retains at most 256 consumed tokens; storage remains a size-bounded preference, not a new JSON file. See OAUTH_REMOTE.md and REVIEW_HANDOFF.md for exact scope.

## Validation

CI runs Node unit tests, TypeScript checking and production builds for integration and both candidate branches before publishing. Test logs are attached. Real Zotero 8 GUI, operating-system firewall and Cloudflare/ChatGPT end-to-end checks remain installation-time acceptance tests. This is a prerelease, not a claim of production validation.
