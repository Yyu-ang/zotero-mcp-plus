# Review integration handoff — 2026-11-20

## Pinned inputs

- Upstream `cookjohn/zotero-mcp:main`: `fad02b8641fe0c04ced4d8d2038339c9c0975692` (v1.7.0).
- Latest pushed fork `cloneorcopy/zotero-mcp-plus:feat/embedded-oauth-chatgpt`: `dd6d06b82d205f180439f2c81d162f4bafb79307` (beta.6).
- Unpushed changes on a user's computer were not accessible and are not claimed to be included.

## Branches

- `integrate/review-fixes-20261120`: upstream merge + fork features + both review fixes + beta metadata.
- `candidate/pr112-review-20261120`: semantic UI only, based directly on pinned upstream; no OAuth or release metadata.
- `candidate/pr120-review-20261120`: OAuth only, based directly on pinned upstream; no semantic UI or release metadata.

No comments or review replies are posted to upstream. Original upstream PR branches are not rewritten.
The proposed integration PR targets cloneorcopy; the prerelease belongs only to Yyu-ang.

## PR #112

- Matching-only keyword OR conditions, awaited item loading and regular-item filtering.
- Atomic awaited collection creation/addition; no false success on DB error; duplicate guard.
- Mixed-library, read-only and missing/ambiguous item results are rejected before collection creation.
- Shared Fluent strings in all six shipped locales; unused old keys removed.
- Runtime preference observer, shutdown cleanup and checks before sending/applying queries.
- Toolbar DOM isolation, actual-parent insertion, single-regular-item Find Similar menu.
- Sequence guard, explicit semantic/hybrid submission, safe text-node highlight rendering.
- Bounded initialization handshake, original replacement SVG, full ZotSeek MIT notice in XPI.
- Displayed scores capped to 100%; chunk labels no longer promise page/paragraph coordinates.

## PR #120

- Retains fork async Login Manager compatibility, manual passwords, fixed clients and custom Q port.
- Bounded dynamic registration, idle eviction, live-token-only DCR persistence and rate limits.
- Bounded preference state remains; optional migration to a JSON data file is deferred.
- Corrected docs outside ignored docs directory, refresh support documented.
- Proxy-marker denial on P, independent Q cleanup/bind error handling, UI port validation.
- Canonical callback host, anti-framing headers, revoke-on-disable, bounded replay detection.
- The fork's requested switch policy is preserved: P may remain LAN-accessible without OAuth while Q is authenticated. **This intentionally differs from upstream's original request to force P to loopback when OAuth is enabled. It must be disclosed and agreed with upstream, not reported as resolved by pretending the policies are identical.**

## Validation boundary

Run `npm run test:unit` and `npm run build` in each branch. The unit suite excludes five existing Zotero-runtime-only suites (write operations and citation runtime behavior); those still require `zotero-plugin test` in a real Zotero environment. Added tests mock Zotero APIs and sockets. They are not a claim of real Zotero 8 UI, live credential vault, firewall or public tunnel validation.

Before production use: install the beta in Zotero, verify all four switch combinations, save a nonempty search result collection, disable semantic search and confirm no new embedding requests, exercise password creation/rotation/restart, and check unauthenticated public `/mcp` returns 401.
