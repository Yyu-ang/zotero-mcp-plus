from pathlib import Path

root = Path('zotero-mcp-plugin')
p = root / 'src/modules/oauthServer.ts'
s = p.read_text()
def replace(old, new):
    global s
    assert old in s, old[:100]
    s = s.replace(old, new)
replace('const MAX_BODY_BYTES = 8192;', '''const MAX_BODY_BYTES = 8192;
const UNUSED_CLIENT_TTL = 30 * 60_000;
const MAX_STATE_BYTES = 768 * 1024;
const REGISTRATION_WINDOW = 60_000;
const MAX_REGISTRATIONS_PER_WINDOW = 60;''')
replace('  fixed?: boolean;', '  createdAt?: number;\n  fixed?: boolean;')
replace('redirects.length > 10', 'redirects.length > 3')
replace('uri.length > 2048', 'new TextEncoder().encode(uri).length > 512')
replace('    const url = new URL(input);', '    if (new TextEncoder().encode(input).length > 300) return null;\n    const url = new URL(input);')
replace('413: "Content Too Large", 503:', '413: "Content Too Large", 429: "Too Many Requests", 503:')
replace('  result.body = body;', '''  result.headers["X-Frame-Options"] = "DENY";
  result.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
  result.headers["Referrer-Policy"] = "no-referrer";
  result.body = body;''')
replace('  private currentSettings = "";', '''  private currentSettings = "";
  private registrationWindow = 0;
  private registrationAttempts = 0;
  private failedLogins = 0;
  private loginWindow = 0;

  /** Headers can deny a request; they are never used to grant trust. */
  revokeSessions(): void {
    this.syncSettings();
    this.codes.clear();
    this.tokens.clear();
    this.refreshTokens.clear();
    for (const [id, client] of this.clients) if (!client.fixed) this.clients.delete(id);
    this.persistState();
  }

  private hasLiveToken(id: string): boolean {
    const now = Date.now();
    return [...this.tokens.values(), ...this.refreshTokens.values()]
      .some(token => token.clientID === id && token.expires > now);
  }

  private hasPendingCode(id: string): boolean {
    return [...this.codes.values()].some(code => code.clientID === id && code.expires > Date.now());
  }

  private makeClientRoom(): boolean {
    this.prune();
    if (this.clients.size < MAX_CLIENTS) return true;
    for (const [id, client] of this.clients) {
      if (!client.fixed && !this.hasLiveToken(id) && !this.hasPendingCode(id)) {
        this.clients.delete(id);
        return true;
      }
    }
    return false;
  }''')
start = s.index('  private persistState(): void {')
end = s.index('\n  private syncSettings()', start)
s = s[:start] + '''  private persistState(): void {
    const now = Date.now();
    const state = JSON.stringify({
      version: STORAGE_VERSION,
      config: this.currentSettings,
      clients: [...this.clients].filter(([id, client]) => client.fixed || this.hasLiveToken(id)),
      tokens: [...this.tokens].filter(([, token]) => token.expires > now),
      refreshTokens: [...this.refreshTokens].filter(([, token]) => token.expires > now),
    });
    if (new TextEncoder().encode(state).length > MAX_STATE_BYTES) {
      throw new Error("OAuth state exceeds its bounded storage budget");
    }
    this.setPref("persistentState", state);
  }
''' + s[end:]
replace('if (typeof raw === "string") {', 'if (typeof raw === "string" && new TextEncoder().encode(raw).length <= MAX_STATE_BYTES) {')
replace('              this.clients.set(clientID, client);', '''              this.clients.set(clientID, {
                redirectURIs: client.redirectURIs,
                authMethod: client.authMethod,
                grantTypes: [...new Set<string>(client.grantTypes)],
                secretDigest: client.secretDigest,
                fixed: client.fixed === true,
                createdAt: Date.now(),
              });''')
replace('            return;\n          }', '''            this.prune();
            for (const [id, client] of this.clients) {
              if (!client.fixed && !this.hasLiveToken(id)) this.clients.delete(id);
            }
            this.persistState();
            return;
          }''')
replace('        } catch { /* Malformed persisted state must never authorize a request. */ }', '''        } catch {
          // Discard partially restored state as well as malformed JSON.
          this.clients.clear(); this.tokens.clear(); this.refreshTokens.clear();
        }''')
replace('if (!existing && this.clients.size >= MAX_CLIENTS)', 'if (!existing && !this.makeClientRoom())')
replace('    if (changed) this.persistState();', '''    for (const [id, client] of this.clients) {
      if (!client.fixed && !this.hasLiveToken(id) && !this.hasPendingCode(id) &&
          now - (client.createdAt || 0) >= UNUSED_CLIENT_TTL) {
        this.clients.delete(id); changed = true;
      }
    }
    if (changed) this.persistState();''')
replace('    const fields = ["client_id",', '''    const redirectHost = new URL(form.get("redirect_uri")!).host;
    const fields = ["client_id",''')
replace('      `<p>Redirect: ${escapeHtml(form.get("redirect_uri") || "")}</p>` +', '''      `<p>Authorize only a client you recognize. Tokens will be sent to:</p>` +
      `<p><strong>${escapeHtml(redirectHost)}</strong></p>` +
      `<p>Redirect: ${escapeHtml(form.get("redirect_uri") || "")}</p>` +''')
replace('    if (path === "/oauth/register") {', '''    if (path === "/oauth/register") {
      const now = Date.now();
      if (now - this.registrationWindow >= REGISTRATION_WINDOW) {
        this.registrationWindow = now; this.registrationAttempts = 0;
      }
      if (++this.registrationAttempts > MAX_REGISTRATIONS_PER_WINDOW) {
        return response(429, { error: "temporarily_unavailable" }, { "Retry-After": "60" });
      }''')
replace('!Array.isArray(grants) || !grants.includes("authorization_code")', '!Array.isArray(grants) || grants.length > 2 || !grants.includes("authorization_code")')
replace('      if (this.clients.size >= MAX_CLIENTS) return response(400, { error: "registration_limit" });', '      if (!this.makeClientRoom()) return response(503, { error: "registration_limit" }, { "Retry-After": "60" });')
replace('authMethod, grantTypes: grants, secretDigest: secret ? await sha256(secret) : undefined });\n      this.persistState();', '''authMethod, grantTypes: [...new Set<string>(grants)], createdAt: Date.now(),
        secretDigest: secret ? await sha256(secret) : undefined });
      // Pending dynamic registrations never write preferences.''')
replace('      const salt = this.pref("passwordSalt") as string;', '''      const now = Date.now();
      if (now - this.loginWindow >= 60_000) { this.loginWindow = now; this.failedLogins = 0; }
      if (this.failedLogins >= 10) return response(429, { error: "temporarily_unavailable" }, { "Retry-After": "60" });
      const salt = this.pref("passwordSalt") as string;''')
replace('        return this.loginPage(form, "Invalid authorization password");', '        this.failedLogins++;\n        return this.loginPage(form, "Invalid authorization password");')
p.write_text(s)

p = root / 'src/modules/preferenceScript.ts'
s = p.read_text().replace('    Zotero.Prefs.set(`${prefix}.enabled`, enabled.checked, true);', '''    if (!enabled.checked) oauthServer.revokeSessions();
    Zotero.Prefs.set(`${prefix}.enabled`, enabled.checked, true);''')
p.write_text(s)

p = Path('.gitignore')
s = p.read_text()
for line in ['!zotero-mcp-plugin/docs/\n', 'zotero-mcp-plugin/docs/*\n', '!zotero-mcp-plugin/docs/*.md\n']:
    s = s.replace(line, '')
p.write_text(s)
p = root / 'docs/oauth-remote.md'
if p.exists(): p.unlink()
