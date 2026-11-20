from pathlib import Path
import subprocess as sp, shutil, re, json
base=Path.cwd()
up='fad02b8641fe0c04ced4d8d2038339c9c0975692'
def git(*args,cwd=base): return sp.check_output(['git',*args],cwd=cwd,text=True)
def copy(dst,path):
 p=dst/path;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(base/path,p)
semantic=[
 'addon/content/icons/icon-toolbar.svg','addon/content/searchDialog.css','addon/content/searchDialog.xhtml','addon/content/searchDialogHelpers.js','addon/THIRD_PARTY_NOTICES.md','src/modules/semanticSearchDialog.ts','test/semanticReview.test.ts','test/reviewHarness.cjs']
oauth=['addon/prefs.js','src/modules/httpServer.ts','src/modules/oauthServer.ts','src/modules/oauthTransportPolicy.ts','src/modules/serverPreferences.ts','src/modules/preferenceScript.ts','scripts/verify-oauth.mjs','test/oauthServer.test.ts','test/oauthReview.test.ts','test/listenerReview.test.ts','test/reviewHarness.cjs','OAUTH_REMOTE.md','typings/prefs.d.ts']
locales=['en-US','zh-CN','de-DE','es-ES','fr-FR','ja-JP']
for number, paths in [(112,semantic),(120,oauth)]:
 dst=base.parent/f'review-pr{number}'
 if dst.exists(): shutil.rmtree(dst)
 git('worktree','prune')
 git('worktree','add','-B',f'candidate/pr{number}-review-20261120',str(dst),up)
 for path in paths: copy(dst,'zotero-mcp-plugin/'+path)
 p=dst/'zotero-mcp-plugin/package.json';d=json.loads(p.read_text());d['scripts']['test:unit']='mocha';p.write_text(json.dumps(d,indent=2)+'\n')
 p=dst/'zotero-mcp-plugin/.mocharc.json';d=json.loads(p.read_text());d['ignore']=['test/writeOperations.test.ts','test/citationExportService.test.ts'];p.write_text(json.dumps(d,indent=2)+'\n')
 hooks=dst/'zotero-mcp-plugin/src/hooks.ts';s=hooks.read_text()
 if number==112:
  s='import { registerSemanticSearchToolbar, registerFindSimilarMenu, unregisterSemanticSearchUI, registerSemanticPreferenceObserver, unregisterSemanticPreferenceObserver } from "./modules/semanticSearchDialog";\n'+s
  s=s.replace('  registerSemanticIndexColumn();', '  registerSemanticIndexColumn();\n  registerSemanticPreferenceObserver();\n  registerSemanticSearchToolbar(win);\n  registerFindSimilarMenu(win);')
  s=s.replace('  unregisterSemanticIndexMenus(win);', '  unregisterSemanticIndexMenus(win);\n  unregisterSemanticSearchUI(win);')
  s=s.replace('      unregisterSemanticIndexMenus(win as unknown as Window);', '      unregisterSemanticIndexMenus(win as unknown as Window);\n      unregisterSemanticSearchUI(win as unknown as Window);')
  s=s.replace('async function onShutdown(): Promise<void> {', 'async function onShutdown(): Promise<void> {\n  unregisterSemanticPreferenceObserver();')
  for locale in locales:
   src=base/f'zotero-mcp-plugin/addon/locale/{locale}/addon.ftl';p=dst/src.relative_to(base)
   lines=[line for line in src.read_text().splitlines() if line.startswith('semantic-') and not line.startswith('semantic-index') or line.startswith('menu-find-similar =')]
   lines=[line for line in lines if line.startswith('semantic-dialog-') or line.startswith(('semantic-search-title =','semantic-search-tooltip =','menu-find-similar ='))]
   p.write_text(p.read_text()+'\n# Semantic search dialog\n'+'\n'.join(lines)+'\n')
  for name in ['README.md','README-zh.md']:
   p=dst/name;p.write_text(p.read_text()+'\n\nSemantic-search UI adapted from ZotSeek, Copyright (c) 2025 José Fernandes, MIT License. See [third-party notices](zotero-mcp-plugin/addon/THIRD_PARTY_NOTICES.md).\n')
  p=dst/'zotero-mcp-plugin/typings/i10n.d.ts';s2=p.read_text().rstrip().removesuffix(';')+'\n  | "semantic-search-title"\n  | "semantic-search-tooltip"\n  | "menu-find-similar";\n';p.write_text(s2)
 else:
  s='import { registerOAuthPreferenceObserver, unregisterOAuthPreferenceObserver } from "./modules/oauthServer";\n'+s
  s=s.replace('  registerSemanticIndexColumn();', '  registerSemanticIndexColumn();\n  registerOAuthPreferenceObserver();')
  s=s.replace('async function onShutdown(): Promise<void> {', 'async function onShutdown(): Promise<void> {\n  unregisterOAuthPreferenceObserver();')
  p=dst/'zotero-mcp-plugin/addon/content/preferences.xhtml';src=(base/p.relative_to(dst)).read_text();a=src.index('      <html:div id="server-oauth-row"');b=src.index('      <html:div class="zmp-sw" style="margin-top:14px;margin-bottom:0">',a)
  text=p.read_text();anchor='      <html:div class="zmp-sw" style="margin-top:14px;margin-bottom:0">';assert anchor in text;text=text.replace(anchor,src[a:b]+anchor,1);p.write_text(text)
  for locale in locales:
   src=base/f'zotero-mcp-plugin/addon/locale/{locale}/preferences.ftl';p=dst/src.relative_to(base)
   lines=[line for line in src.read_text().splitlines() if line.startswith('pref-oauth-')]
   p.write_text(p.read_text()+'\n# Optional OAuth\n'+'\n'.join(lines)+'\n')
  p=dst/'zotero-mcp-plugin/src/modules/preferenceScript.ts';s2=p.read_text()
  s2='\n'.join(line for line in s2.split('\n') if 'citation-file-tools-enabled' not in line)
  p.write_text(s2)
  for name in ['README.md','README-zh.md']:
   p=dst/name;p.write_text(p.read_text()+'\n\n## Optional remote OAuth\n\nSee [OAuth setup and entry-point security](zotero-mcp-plugin/OAUTH_REMOTE.md).\nThe ordinary port is unauthenticated; publish only the OAuth port through HTTPS.\n')
 hooks.write_text(s)
 git('add','.',cwd=dst);git('commit','-m',f'feat: prepare PR #{number} review candidate on upstream v1.7.0',cwd=dst)
 print(number,git('rev-parse','HEAD',cwd=dst).strip())
 (dst/'zotero-mcp-plugin/node_modules').symlink_to(base/'zotero-mcp-plugin/node_modules',target_is_directory=True)
