from pathlib import Path
root=Path('zotero-mcp-plugin')
p=root/'src/modules/oauthServer.ts';s=p.read_text()
s=s.replace('      if (!this.makeClientRoom()) return response(503, { error: "registration_limit" }, { "Retry-After": "60" });\n      const id', '      const id')
s=s.replace('      this.clients.set(id, { redirectURIs: metadata.redirect_uris,\n        authMethod, grantTypes: [...new Set<string>(grants)], createdAt: Date.now(),\n        secretDigest: secret ? await sha256(secret) : undefined });', '''      const epoch = this.authorizationEpoch;
      const secretDigest = secret ? await sha256(secret) : undefined;
      if (!this.ready() || epoch !== this.authorizationEpoch) return response(503, { error: "temporarily_unavailable" });
      if (!this.makeClientRoom()) return response(503, { error: "registration_limit" }, { "Retry-After": "60" });
      this.clients.set(id, { redirectURIs: metadata.redirect_uris,
        authMethod, grantTypes: [...new Set<string>(grants)], createdAt: Date.now(), secretDigest });''')
s+='''
let oauthPreferenceObserver: symbol | undefined;
export function registerOAuthPreferenceObserver(): void {
  if (oauthPreferenceObserver !== undefined) return;
  oauthPreferenceObserver = Zotero.Prefs.registerObserver(`${PREFIX}.enabled`, () => {
    if (!oauthServer.isEnabled()) oauthServer.revokeSessions();
  }, true);
}
export function unregisterOAuthPreferenceObserver(): void {
  if (oauthPreferenceObserver !== undefined) Zotero.Prefs.unregisterObserver(oauthPreferenceObserver);
  oauthPreferenceObserver = undefined;
}
'''
p.write_text(s)
p=root/'src/hooks.ts';s=p.read_text();s='import { registerOAuthPreferenceObserver, unregisterOAuthPreferenceObserver } from "./modules/oauthServer";\n'+s
s=s.replace('  registerSemanticPreferenceObserver();', '  registerOAuthPreferenceObserver();\n  registerSemanticPreferenceObserver();')
s=s.replace('  unregisterSemanticPreferenceObserver();', '  unregisterOAuthPreferenceObserver();\n  unregisterSemanticPreferenceObserver();');p.write_text(s)
p=root/'src/modules/httpServer.ts';s=p.read_text().replace('          Zotero.getMainWindow()?.alert(message);', '          try { Zotero.getMainWindow()?.alert(message); } catch { /* reporting cannot stop local MCP */ }');p.write_text(s)
p=root/'addon/content/searchDialog.xhtml';s=p.read_text()
s=s.replace('    window.invalidateSearch = invalidateSearch;', '''    window.invalidateSearch = invalidateSearch;
    window.beginExternalSearch = () => { invalidateSearch(); return searchSequence; };
    window.isCurrentSearch = sequence => sequence === searchSequence && args.isEnabled();''')
p.write_text(s)
p=root/'src/modules/semanticSearchDialog.ts';s=p.read_text().replace('      win.invalidateSearch?.();', '      const sequence = win.beginExternalSearch?.();')
s=s.replace('request === this.similarRequest && !win.closed)', 'request === this.similarRequest && !win.closed && win.isCurrentSearch?.(sequence))');p.write_text(s)
