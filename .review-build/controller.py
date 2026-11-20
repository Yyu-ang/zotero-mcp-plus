from pathlib import Path
root=Path('zotero-mcp-plugin')
p=root/'src/modules/semanticSearchDialog.ts';s=p.read_text()
s=s.replace('UI adapted from ZotSeek (https://github.com/introfini/ZotSeek), MIT License.', 'Adapted from ZotSeek (https://github.com/introfini/ZotSeek),\n * Copyright (c) 2025 José Fernandes, MIT License. See THIRD_PARTY_NOTICES.md.')
s=s.replace('  private window: any = null;', '  private window: any = null;\n  private generation = 0;\n  private similarRequest = 0;')
s=s.replace('  open(initialQuery?: string): void {\n    try {', '  open(initialQuery?: string): void {\n    if (!semanticSearchEnabled()) return;\n    try {')
s=s.replace("        initialQuery: initialQuery || '',", '''        initialQuery: initialQuery || '',
        isEnabled: semanticSearchEnabled,
        translate: (key: string, args?: Record<string, unknown>) => getString(key as any, { args }),''')
s=s.replace('  close(): void {', '  close(): void {\n    this.generation++; this.similarRequest++;')
s=s.replace('    ztoolkit.log(`[SemanticDialog] Performing search: "${query}"`);', '''    if (!semanticSearchEnabled()) throw new Error(getString('semantic-dialog-disabled' as any));
    const generation = this.generation;''')
s=s.replace('    ztoolkit.log(`[SemanticDialog] Found ${results.length} results`);', '''    if (!semanticSearchEnabled() || generation !== this.generation) return [];
    ztoolkit.log(`[SemanticDialog] Found ${results.length} results`);''')
a=s.index('  async findSimilar(');b=s.index('  /**\n   * 在 Zotero',a)
s=s[:a]+'''  async findSimilar(itemKey: string, title?: string): Promise<void> {
    if (!semanticSearchEnabled()) return;
    const request = ++this.similarRequest;
    const generation = this.generation;
    this.open();
    const win = this.window;
    try {
      await this.waitForWindowReady();
      if (!semanticSearchEnabled() || generation !== this.generation || request !== this.similarRequest) return;
      win.invalidateSearch?.();
      win.showProgress?.(getString('semantic-dialog-finding-similar' as any));
      const results = await getSemanticSearchService().findSimilar(itemKey, { topK: 15 });
      if (semanticSearchEnabled() && generation === this.generation && request === this.similarRequest && !win.closed) {
        await win.displayResults?.(results);
      }
    } catch (error) {
      if (win && !win.closed && semanticSearchEnabled()) win.showError?.(getString('semantic-dialog-search-failed' as any,
        { args: { error: error instanceof Error ? error.message : String(error) } }));
    }
  }

  private waitForWindowReady(): Promise<void> {
    const win = this.window;
    return new Promise((resolve, reject) => {
      if (!win || win.closed) return reject(new Error('Search window unavailable'));
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        win.removeEventListener('semantic-ready', ready);
        win.removeEventListener('unload', closed);
      };
      const ready = () => {
        if (win._semanticInitError) { cleanup(); reject(win._semanticInitError); }
        else if (win._semanticReady) { cleanup(); resolve(); }
      };
      const closed = () => { cleanup(); reject(new Error('Search window closed')); };
      timer = setTimeout(() => { cleanup(); reject(new Error('Search window initialization timed out')); }, 10_000);
      win.addEventListener('semantic-ready', ready);
      win.addEventListener('unload', closed, { once: true });
      ready();
    });
  }

''' +s[b:]
s=s.replace('export function registerSemanticSearchToolbar(', 'function registerSemanticSearchToolbarUnsafe(')
s=s.replace('export function registerFindSimilarMenu(', 'function registerFindSimilarMenuUnsafe(')
s=s.replace("  const toolbar = doc.getElementById('zotero-items-toolbar');", "  const search = doc.getElementById('zotero-tb-search');\n  const toolbar = search?.parentNode || doc.getElementById('zotero-items-toolbar');")
s=s.replace("  const searchBox = toolbar.querySelector('#zotero-tb-search');", '  const searchBox = search;')
s=s.replace('    toolbar.insertBefore(separator, searchBox);', '    searchBox.parentNode!.insertBefore(separator, searchBox);')
s=s.replace('    toolbar.insertBefore(button, separator);', '    separator.parentNode!.insertBefore(button, separator);')
s=s.replace('    if (!selectedItems || selectedItems.length === 0) return;', '    if (!semanticSearchEnabled() || selectedItems?.length !== 1 || !selectedItems[0].isRegularItem()) return;')
s=s.replace('  const itemMenu = doc.getElementById', '''  menuCleanup.get(win)?.();
  const itemMenu = doc.getElementById''')
s=s.replace('  itemMenu.appendChild(separator);', '''  const updateVisibility = () => {
    const selected = win.ZoteroPane?.getSelectedItems();
    const hidden = !semanticSearchEnabled() || selected?.length !== 1 || !selected[0].isRegularItem();
    menuItem.setAttribute('hidden', String(hidden)); separator.setAttribute('hidden', String(hidden));
  };
  itemMenu.addEventListener('popupshowing', updateVisibility);
  menuCleanup.set(win, () => itemMenu.removeEventListener('popupshowing', updateVisibility));
  itemMenu.appendChild(separator);''')
s=s.replace('export function unregisterSemanticSearchUI(win: Window): void {\n  try {', 'export function unregisterSemanticSearchUI(win: Window): void {\n  try {\n    menuCleanup.get(win)?.(); menuCleanup.delete(win);')
s+='''
const SEMANTIC_PREF = 'extensions.zotero.zotero-mcp-plugin.semantic.enabled';
let preferenceObserver: symbol | undefined;
const menuCleanup = new WeakMap<object, () => void>();
export function semanticSearchEnabled(): boolean { return Zotero.Prefs.get(SEMANTIC_PREF, true) !== false; }
export function registerSemanticSearchToolbar(win: _ZoteroTypes.MainWindow): void {
  try { registerSemanticSearchToolbarUnsafe(win); }
  catch (error) { ztoolkit.log(`[SemanticDialog] Toolbar registration failed: ${error}`, 'warn'); }
}
export function registerFindSimilarMenu(win: _ZoteroTypes.MainWindow): void {
  try { registerFindSimilarMenuUnsafe(win); }
  catch (error) { ztoolkit.log(`[SemanticDialog] Menu registration failed: ${error}`, 'warn'); }
}
export function registerSemanticPreferenceObserver(): void {
  if (preferenceObserver !== undefined) return;
  preferenceObserver = Zotero.Prefs.registerObserver(SEMANTIC_PREF, () => {
    for (const win of Zotero.getMainWindows()) {
      if (semanticSearchEnabled()) { registerSemanticSearchToolbar(win); registerFindSimilarMenu(win); }
      else unregisterSemanticSearchUI(win);
    }
    if (!semanticSearchEnabled()) dialogInstance?.close();
  }, true);
}
export function unregisterSemanticPreferenceObserver(): void {
  if (preferenceObserver !== undefined) Zotero.Prefs.unregisterObserver(preferenceObserver);
  preferenceObserver = undefined;
  dialogInstance?.close();
}
'''
p.write_text(s)
p=root/'src/hooks.ts';s=p.read_text()
s=s.replace('unregisterSemanticSearchUI }', 'unregisterSemanticSearchUI, registerSemanticPreferenceObserver, unregisterSemanticPreferenceObserver }')
s=s.replace('  registerSemanticSearchToolbar(win);', '  registerSemanticPreferenceObserver();\n  registerSemanticSearchToolbar(win);')
s=s.replace('async function onShutdown(): Promise<void> {', 'async function onShutdown(): Promise<void> {\n  unregisterSemanticPreferenceObserver();')
p.write_text(s)
p=root/'addon/content/searchDialog.xhtml';s=p.read_text().replace("result.title || 'Untitled'", "result.title || t('untitled')")
s=s.replace('      if (collectQueries().length > 0) performSearch().catch(() => {});', "      if (searchMode === 'keyword' && collectQueries().length > 0) performSearch().catch(() => {});")
p.write_text(s)
