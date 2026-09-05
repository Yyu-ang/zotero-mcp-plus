from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "zotero-mcp-plugin"
SOURCE_REF = "2ca4cbeb7a9e9820f1b07a29196b37133dfb99fc"
SKELETON_COMMIT = "0c592a0de0e776f6cd495a9e49500e6e75864d98"

XHTML = PLUGIN / "addon/content/searchDialog.xhtml"
CSS = PLUGIN / "addon/content/searchDialog.css"
CONTROLLER = PLUGIN / "src/modules/semanticSearchDialog.ts"
ICON = PLUGIN / "addon/content/icons/icon-toolbar.svg"
README = ROOT / "README.md"

EXPECTED = sorted([
    "README.md",
    "zotero-mcp-plugin/addon/content/icons/icon-toolbar.svg",
    "zotero-mcp-plugin/addon/content/searchDialog.css",
    "zotero-mcp-plugin/addon/content/searchDialog.xhtml",
    "zotero-mcp-plugin/addon/locale/de-DE/addon.ftl",
    "zotero-mcp-plugin/addon/locale/en-US/addon.ftl",
    "zotero-mcp-plugin/addon/locale/es-ES/addon.ftl",
    "zotero-mcp-plugin/addon/locale/fr-FR/addon.ftl",
    "zotero-mcp-plugin/addon/locale/ja-JP/addon.ftl",
    "zotero-mcp-plugin/addon/locale/zh-CN/addon.ftl",
    "zotero-mcp-plugin/src/hooks.ts",
    "zotero-mcp-plugin/src/modules/semanticSearchDialog.ts",
    "zotero-mcp-plugin/typings/i10n.d.ts",
])


def run(*args: str) -> str:
    return subprocess.check_output(args, cwd=ROOT, text=True)


# Start from the already clean cookjohn-based semantic integration skeleton.
subprocess.check_call(["git", "fetch", "origin", "pr92-semantic-search-dialog"], cwd=ROOT)
subprocess.check_call(["git", "cherry-pick", SKELETON_COMMIT], cwd=ROOT)

# Pull only the user-validated final semantic UI/controller/icon from cloneorcopy #11.
try:
    subprocess.check_call(["git", "remote", "add", "cloneorcopy", "https://github.com/cloneorcopy/zotero-mcp-plus.git"], cwd=ROOT)
except subprocess.CalledProcessError:
    pass
subprocess.check_call(["git", "fetch", "cloneorcopy", "main"], cwd=ROOT)

for rel, dest in [
    ("zotero-mcp-plugin/addon/content/searchDialog.xhtml", XHTML),
    ("zotero-mcp-plugin/addon/content/searchDialog.css", CSS),
    ("zotero-mcp-plugin/src/modules/semanticSearchDialog.ts", CONTROLLER),
    ("zotero-mcp-plugin/addon/content/icons/icon-toolbar.svg", ICON),
]:
    content = run("git", "show", f"{SOURCE_REF}:{rel}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content, encoding="utf-8")

# Ensure the text SVG itself carries attribution without changing rendering.
icon = ICON.read_text(encoding="utf-8")
if "ZotSeek" not in icon:
    icon = "<!-- Toolbar icon used with the ZotSeek-adapted semantic search UI; ZotSeek is MIT licensed. -->\n" + icon
    ICON.write_text(icon, encoding="utf-8")

# Keep upstream README version/release metadata untouched; add only required MIT attribution.
readme = README.read_text(encoding="utf-8")
ack = """### Acknowledgment\n\nThe semantic-search dialog UI is adapted from [ZotSeek](https://github.com/introfini/ZotSeek) by José Fernandes and is used under the MIT License.\n\n"""
marker = "## 🚀 Project Structure\n"
if ack not in readme:
    if readme.count(marker) != 1:
        raise RuntimeError("README project structure marker is not unique")
    readme = readme.replace(marker, ack + marker, 1)
README.write_text(readme, encoding="utf-8")

# Strong invariants: full ZotSeek-derived UI, not the previously simplified dialog.
xhtml = XHTML.read_text(encoding="utf-8")
css = CSS.read_text(encoding="utf-8")
controller = CONTROLLER.read_text(encoding="utf-8")
for token in [
    "VirtualizedTableHelper",
    "zotseek-query-4",
    "query-combine-operator",
    "search-mode-select",
    "granularity-location",
    "zotseek-save-collection-btn",
    "setupSnippetTooltip",
    "hoveredSnippetRow",
    "searchMode === 'semantic'",
    '<html:div id="zotseek-results-container"/>',
]:
    if token not in xhtml:
        raise RuntimeError(f"missing full semantic UI invariant: {token}")
for token in ["overflow-y: auto !important", ".tree-children", ".zotseek-snippet-tooltip"]:
    if token not in css:
        raise RuntimeError(f"missing semantic CSS invariant: {token}")
for token in [
    "config.addonRef",
    "getString('menu-find-similar')",
    "getByLibraryAndKeyAsync",
    "Zotero.Libraries.getAll()",
    "semantic.enabled",
    "topK: 15",
]:
    if token not in controller:
        raise RuntimeError(f"missing semantic controller invariant: {token}")

# Do not let unrelated PR92 features leak into this split.
if "CitationExportService" in controller or "ToolRegistry" in controller:
    raise RuntimeError("unrelated feature leaked into semantic controller")

changed = run("git", "diff", "--name-only", "HEAD").splitlines()
untracked = run("git", "ls-files", "--others", "--exclude-standard").splitlines()
# HEAD is the skeleton commit after cherry-pick; include its committed files by comparing to parent/base.
base = "5b0640f0f39f9ecaaeaa76bbf7c43f76bcef9599"
all_changed = run("git", "diff", "--name-only", base).splitlines()
actual = sorted(set(all_changed + untracked))
if actual != EXPECTED:
    raise RuntimeError(f"Unexpected semantic split scope: {actual}")

print("Prepared full semantic dialog split with reviewed ZotSeek interactions")
