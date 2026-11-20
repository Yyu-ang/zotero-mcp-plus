from pathlib import Path
import re, shutil
root = Path('zotero-mcp-plugin')
shutil.copyfile(Path(__file__).with_name('searchDialogHelpers.js'), root/'addon/content/searchDialogHelpers.js')
p=root/'addon/content/searchDialog.xhtml';s=p.read_text()
a=s.index('    // ========== i18n');b=s.index('    // ========== Window Arguments',a)
s=s[:a]+'''    // Use the plugin's shared Fluent localization, including all six locales.
    function t(key, params) {
      return window.arguments[0].translate('semantic-dialog-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), params);
    }
''' + s[b:]
s=s.replace('  <script src="chrome://zotero/content/include.js">', '''  <linkset><html:link rel="localization" href="__addonRef__-addon.ftl"/></linkset>
  <script src="chrome://__addonRef__/content/searchDialogHelpers.js"></script>
  <script src="chrome://zotero/content/include.js">''')
s=s.replace('    let searchTimer = null;', '''    let searchTimer = null;
    let searchSequence = 0;
    let saving = false;
    function invalidateSearch() { searchSequence++; clearTimeout(searchTimer); hideSnippetTooltip(); }
    function scheduleSearch() {
      invalidateSearch();
      if (searchMode === 'keyword') searchTimer = setTimeout(performSearch, 500);
    }
    window.addEventListener('unload', invalidateSearch, { once: true });''')
s=s.replace('      init();', '''      try { init(); window._semanticReady = true; window.dispatchEvent(new Event('semantic-ready')); }
      catch (error) { window._semanticInitError = error; window.dispatchEvent(new Event('semantic-ready')); }''')
a=s.index("      query1.addEventListener('input'");b=s.index("      query1.addEventListener('keypress'",a)
s=s[:a]+"      query1.addEventListener('input', scheduleSearch);\n"+s[b:]
a=s.index("          input.addEventListener('input'");b=s.index("          input.addEventListener('keypress'",a)
s=s[:a]+'''          if (!input.dataset.bound) {
            input.dataset.bound = 'true';
            input.addEventListener('input', scheduleSearch);
''' +s[b:]
s=s.replace("          });\n        }\n      }\n      if (activeQueryCount >= 2)", "          });\n          }\n        }\n      }\n      if (activeQueryCount >= 2)")
for name in ['addQuery', 'removeQuery', 'updateOperatorUI', 'onSearchModeChange']:
    s=re.sub(r'(    function '+name+r'\([^)]*\) \{)',r'\1\n      invalidateSearch();',s)
s=s.replace('    async function performSearch() {', '''    async function performSearch() {
      const sequence = ++searchSequence;
      clearTimeout(searchTimer);
      if (!args.isEnabled()) { window.close(); return; }''')
s=s.replace('        for (const query of queries) {', '''        for (const query of queries) {
          if (sequence !== searchSequence || !args.isEnabled()) return;''')
s=s.replace('searchCallback(query).catch(() => [])', 'searchCallback(query)').replace('keywordSearch(query).catch(() => [])', 'keywordSearch(query)')
s=s.replace('        let finalResults;', '        if (sequence !== searchSequence || !args.isEnabled() || window.closed) return;\n        let finalResults;')
s=s.replace('        updateMatchStats(searchResults);', '        if (sequence !== searchSequence || !args.isEnabled() || window.closed) return;\n        updateMatchStats(searchResults);')
s=s.replace("        showStatus(t('searchFailed', { error: error.message || String(error) }));", "        if (sequence === searchSequence && !window.closed) showStatus(t('searchFailed', { error: error.message || String(error) }));")
a=s.index('    async function keywordSearch(');b=s.index('    function buildKeywordResult',a)
s=s[:a]+'''    async function keywordSearch(query) {
      const items = await SemanticDialogHelpers.keywordItems(Zotero, query, Zotero.Libraries.userLibraryID);
      return items.map(item => buildKeywordResult(item, query));
    }

''' +s[b:]
s=s.replace('item.getItemType().name', 'item.itemType')
s=s.replace("item.getDisplayTitle() || 'Untitled'", "item.getDisplayTitle() || t('untitled')")
s=s.replace('itemKey: item.key, parentKey:', 'itemKey: item.key, libraryID: item.libraryID, parentKey:')
s=s.replace("'Table init error: ' +", "t('tableError') + ': ' +")
s=s.replace('Math.round(result.score * 100)', 'Math.round(Math.max(0, Math.min(1, result.score)) * 100)')
s=s.replace('Math.round(score * 100)', 'Math.round(Math.max(0, Math.min(1, score)) * 100)')
a=s.index('    async function saveAsCollection()');b=s.index('    // ========== Snippet Tooltip',a)
s=s[:a]+'''    async function saveAsCollection() {
      if (saving || !args.isEnabled()) return;
      saving = true;
      const button = document.getElementById('zotseek-save-collection-btn');
      button.disabled = true;
      try {
        const name = (t('saveCollection') + ': ' + collectQueries().join(' / ')).substring(0, 100);
        const count = await SemanticDialogHelpers.saveCollection(Zotero, [...searchResults], name);
        if (!window.closed) showStatus(t('savedCollection', { count, name }));
      } catch (error) {
        if (!window.closed) showStatus(t('saveFailed', { error: error.message || String(error) }));
      } finally {
        saving = false;
        if (!window.closed) button.disabled = searchResults.length === 0;
      }
    }

''' +s[b:]
s=s.replace("document.getElementById('zotseek-save-collection-btn').disabled = false;", "document.getElementById('zotseek-save-collection-btn').disabled = saving;")
s=s.replace('      snippetTooltip.innerHTML = html;', '      snippetTooltip.replaceChildren(html);')
s=s.replace("      return head + '<div class=\"zotseek-snippet-body\">' + body + '</div>';", '''      const fragment = document.createDocumentFragment();
      const heading = document.createElementNS(HTML_NS, 'div');
      heading.className = 'zotseek-snippet-meta';
      heading.textContent = meta.join(' · ');
      const content = document.createElementNS(HTML_NS, 'div');
      content.className = 'zotseek-snippet-body';
      content.appendChild(body);
      fragment.appendChild(heading); fragment.appendChild(content);
      return fragment;''')
a=s.index('    function highlightSnippet(');b=s.index('    /**',a)
s=s[:a]+'''    function highlightSnippet(text) {
      return SemanticDialogHelpers.highlight(document, text, highlightTerms);
    }

''' +s[b:]
s=s.replace("replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')", "replace(/^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$/gu, '')")
s=s.replace("page = '¶' + (result._chunk.chunkId + 1);", "page = t('matchedChunk', { n: result._chunk.chunkId + 1 });")
s=s.replace("meta.push('📍 ' + t('colLocation') + ': ¶' + paraNum);", "meta.push(t('matchedChunk', { n: paraNum }));")
s=s.replace('    window.displayResults = async (results) => {', '''    window.displayResults = async (results) => {
      if (!args.isEnabled() || window.closed) return;
      invalidateSearch();
      setQueryTerms([]);''')
s=s.replace('    window.showProgress = showStatus;', '    window.invalidateSearch = invalidateSearch;\n    window.showProgress = showStatus;')
s=s.replace('MIT License. -->', 'Copyright (c) 2025 José Fernandes, MIT License. See THIRD_PARTY_NOTICES.md. -->')
p.write_text(s)
p=root/'addon/content/searchDialog.css';s=p.read_text().replace('MIT License.', 'Copyright (c) 2025 José Fernandes, MIT License. See THIRD_PARTY_NOTICES.md.');p.write_text(s)"}