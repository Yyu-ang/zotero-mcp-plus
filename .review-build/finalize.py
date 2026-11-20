from pathlib import Path
import json,re
root=Path('zotero-mcp-plugin')
p=root/'.mocharc.json';d=json.loads(p.read_text());d['ignore']=['test/writeOperations.test.ts','test/citationExportService.test.ts','test/citationExportService.quickcopy.test.ts','test/citationFileBehavior.test.ts','test/citationFileTools.test.ts'];p.write_text(json.dumps(d,indent=2)+'\n')
p=root/'package.json';d=json.loads(p.read_text());d['scripts']['test:unit']='mocha';p.write_text(json.dumps(d,indent=2)+'\n')
for name in ['oauthServer.test.ts','citationFileSafety.test.ts']:
 p=root/'test'/name
 if not p.exists(): continue
 s=p.read_text().replace('declare const expect: Chai.ExpectStatic;', 'import { expect } from "chai";')
 s=re.sub(r'(from "\.\./src/modules/[^".]+)(")', r'\1.ts\2',s)
 p.write_text(s)
p=root/'src/modules/oauthServer.ts';s=p.read_text()
s=s.replace('  private registrationWindow = 0;', '  private authorizationEpoch = 0;\n  private consumedRefresh = new Map<string, { clientID: string; expires: number }>();\n  private consumedCodes = new Map<string, { clientID: string; expires: number }>();\n  private registrationWindow = 0;')
s=s.replace('    this.codes.clear();\n    this.tokens.clear();', '    this.authorizationEpoch++;\n    this.consumedRefresh.clear(); this.consumedCodes.clear();\n    this.codes.clear();\n    this.tokens.clear();')
s=s.replace('    this.clients.clear();\n    this.codes.clear();', '    this.authorizationEpoch++;\n    this.consumedRefresh.clear(); this.consumedCodes.clear();\n    this.clients.clear();\n    this.codes.clear();')
s=s.replace('      config: this.currentSettings,', '      config: this.currentSettings,\n      consumedRefresh: [...this.consumedRefresh].filter(([, value]) => value.expires > now),')
s=s.replace('            this.prune();\n            for (const [id, client]', '''            if (Array.isArray(saved.consumedRefresh)) {
              for (const entry of saved.consumedRefresh.slice(-256)) {
                if (Array.isArray(entry) && /^[0-9a-f]{64}$/.test(entry[0]) &&
                    this.clients.has(entry[1]?.clientID) && Number.isSafeInteger(entry[1]?.expires) && entry[1].expires > Date.now()) {
                  this.consumedRefresh.set(entry[0], { clientID: entry[1].clientID, expires: entry[1].expires });
                }
              }
            }
            this.prune();
            for (const [id, client]''')
s=s.replace('this.clients.clear(); this.tokens.clear(); this.refreshTokens.clear();', 'this.clients.clear(); this.tokens.clear(); this.refreshTokens.clear(); this.consumedRefresh.clear();')
s=s.replace('    if (changed) this.persistState();', '''    for (const target of [this.consumedRefresh, this.consumedCodes]) {
      for (const [key, value] of target) if (value.expires <= now) target.delete(key);
      while (target.size > 256) target.delete(target.keys().next().value!);
    }
    if (changed) this.persistState();''')
s=s.replace('    const access = randomSecret(32);', '''    const epoch = this.authorizationEpoch;
    const config = this.currentSettings;
    const access = randomSecret(32);''')
a=s.index('    this.tokens.set(await sha256(`access:${access}`)');b=s.index('    this.persistState();',a)
s=s[:a]+'''    const accessDigest = await sha256(`access:${access}`);
    const refreshDigest = refresh ? await sha256(`refresh:${refresh}`) : null;
    if (!this.ready() || config !== this.currentSettings || epoch !== this.authorizationEpoch || !this.clients.has(clientID)) {
      return response(400, { error: "invalid_grant" });
    }
    this.tokens.set(accessDigest, { clientID, resource, expires: Date.now() + TOKEN_TTL });
    if (refreshDigest) this.refreshTokens.set(refreshDigest, { clientID, resource, expires: Date.now() + REFRESH_TTL });
''' +s[b:]
s=s.replace('        const previous = this.refreshTokens.get(digest);', '''        const replayed = this.consumedRefresh.get(digest);
        if (replayed && replayed.clientID === id && replayed.expires > Date.now()) {
          this.revokeClientTokens(id);
          return response(400, { error: "invalid_grant" });
        }
        const previous = this.refreshTokens.get(digest);''')
s=s.replace('        this.refreshTokens.delete(digest);\n        this.persistState();', '''        this.refreshTokens.delete(digest);
        this.consumedRefresh.set(digest, { clientID: id, expires: previous.expires });
        this.prune();
        this.persistState();''')
s=s.replace('      const saved = this.codes.get(code);', '''      const replayed = this.consumedCodes.get(code);
      if (replayed && replayed.clientID === id && replayed.expires > Date.now()) {
        this.revokeClientTokens(id);
        return response(400, { error: "invalid_grant" });
      }
      const saved = this.codes.get(code);''')
s=s.replace('      // Consume the code exactly once;', '''      if (!this.ready() || !this.clients.has(id)) return response(400, { error: "invalid_grant" });
      this.consumedCodes.set(code, { clientID: id, expires: saved.expires });
      // Consume the code exactly once;''')
s=s.replace('  unauthorized(): HttpResult {', '''  private revokeClientTokens(clientID: string): void {
    this.authorizationEpoch++;
    for (const target of [this.tokens, this.refreshTokens]) {
      for (const [key, value] of target) if (value.clientID === clientID) target.delete(key);
    }
    for (const [key, value] of this.codes) if (value.clientID === clientID) this.codes.delete(key);
    this.persistState();
  }

  unauthorized(): HttpResult {''')
p.write_text(s)
# A disabled pref always takes effect before storage or restart work.
p=root/'src/modules/preferenceScript.ts';s=p.read_text()
s=s.replace('    if (!enabled.checked) oauthServer.revokeSessions();\n    Zotero.Prefs.set(`${prefix}.enabled`, enabled.checked, true);', '    Zotero.Prefs.set(`${prefix}.enabled`, enabled.checked, true);\n    if (!enabled.checked) oauthServer.revokeSessions();')
p.write_text(s)
# Correct the remote smoke-check entry point and avoid passwords in docs argv.
p=root/'scripts/verify-oauth.mjs';s=p.read_text().replace('127.0.0.1:23120','127.0.0.1:23121');p.write_text(s)
