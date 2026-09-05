from pathlib import Path

path = Path('zotero-mcp-plugin/test/citationExportService.test.ts')
text = path.read_text(encoding='utf-8')

old = '''  it("uses bibliography QuickCopy format and fourth argument for in-text citations", async function () {\n    const service = new CitationExportService();'''
new = '''  it("uses bibliography QuickCopy format and fourth argument for in-text citations", async function () {\n    await (Zotero.Schema as any).schemaUpdatePromise;\n    const service = new CitationExportService();'''
if text.count(old) != 1:
    raise RuntimeError('style readiness test patch did not match exactly once')
text = text.replace(old, new, 1)

text = text.replace(
    'Zotero.Prefs.set(QUICK_COPY_PREF, `bibliography/html=${testStyle}`, true);',
    'Zotero.Prefs.set(QUICK_COPY_PREF, `bibliography/html=${testStyle}`);',
    1,
)
text = text.replace(
    'Zotero.Prefs.set(QUICK_COPY_PREF, previous, true);',
    'Zotero.Prefs.set(QUICK_COPY_PREF, previous);',
    1,
)

path.write_text(text, encoding='utf-8')
