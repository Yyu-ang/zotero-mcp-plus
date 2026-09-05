from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "zotero-mcp-plugin"
SERVICE = PLUGIN / "src/modules/citationExportService.ts"
SERVER = PLUGIN / "src/modules/streamableMCPServer.ts"
BASE_SOURCE = "c616d620427cbbd075d48caf6560ddd9c9f72728"
REVIEW_REF = "origin/review/pr92-safe-citation-files-v2"

NON_CODE_PATHS = [
    "zotero-mcp-plugin/addon/content/preferences.xhtml",
    "zotero-mcp-plugin/addon/locale/de-DE/preferences.ftl",
    "zotero-mcp-plugin/addon/locale/en-US/preferences.ftl",
    "zotero-mcp-plugin/addon/locale/es-ES/preferences.ftl",
    "zotero-mcp-plugin/addon/locale/fr-FR/preferences.ftl",
    "zotero-mcp-plugin/addon/locale/ja-JP/preferences.ftl",
    "zotero-mcp-plugin/addon/locale/zh-CN/preferences.ftl",
    "zotero-mcp-plugin/src/modules/citationFileSafety.ts",
    "zotero-mcp-plugin/test/citationFileBehavior.test.ts",
    "zotero-mcp-plugin/test/citationFileSafety.test.ts",
    "zotero-mcp-plugin/test/citationFileTools.test.ts",
    "zotero-mcp-plugin/typings/i10n.d.ts",
]

EXPECTED = sorted(NON_CODE_PATHS + [
    "zotero-mcp-plugin/src/modules/citationExportService.ts",
    "zotero-mcp-plugin/src/modules/streamableMCPServer.ts",
])


def run(*args: str) -> str:
    return subprocess.check_output(args, cwd=ROOT, text=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def extract(text: str, start: str, end: str, label: str, include_end: bool = False) -> str:
    if text.count(start) != 1:
        raise RuntimeError(f"{label}: start marker count={text.count(start)}")
    s = text.index(start)
    e = text.index(end, s)
    if include_end:
        e += len(end)
    return text[s:e]


subprocess.check_call(["git", "fetch", "origin", "review/pr92-safe-citation-files-v2"], cwd=ROOT)
try:
    subprocess.check_call(["git", "remote", "add", "cloneorcopy", "https://github.com/cloneorcopy/zotero-mcp-plus.git"], cwd=ROOT)
except subprocess.CalledProcessError:
    pass
subprocess.check_call(["git", "fetch", "cloneorcopy", "main"], cwd=ROOT)

# 1) Take the reviewed safe citation service, then re-apply the three independently
# validated QuickCopy fixes from split ①. This keeps sync_bib/cite behavior from
# cloneorcopy while ensuring the stacked branch does not regress get_citation.
service = run("git", "show", f"{REVIEW_REF}:zotero-mcp-plugin/src/modules/citationExportService.ts")
service = replace_once(
    service,
    "      format = `${mode}=${resolved.styleID}`;",
    "      format = `bibliography=${resolved.styleID}`;",
    "explicit style QuickCopy prefix",
)
old_default = '''      // 使用 Zotero 默认 Quick Copy 设置\n      const defaultSetting =\n        (Zotero.Prefs.get("export.quickCopy.setting") as string) || "";\n      const prefix = defaultSetting.split("=")[0];\n\n      if (\n        defaultSetting &&\n        (prefix === "bibliography" || prefix === "citation")\n      ) {\n        // 默认设置本身就是引文格式，按需调整前缀以匹配请求模式\n        const styleIdPart = defaultSetting.substring(\n          defaultSetting.indexOf("=") + 1,\n        );\n        format = `${mode}=${styleIdPart}`;\n        styleInfo = { isDefault: true, id: styleIdPart };\n      } else {\n        // 默认设置非引文格式，回退到 APA\n        const fallback = "http://www.zotero.org/styles/apa";\n        format = `${mode}=${fallback}`;\n        styleInfo = { isDefault: true, id: fallback, title: "APA (fallback)" };\n      }'''
new_default = '''      // 使用 Zotero 默认 Quick Copy 设置。通过 Zotero 自己的解析器处理\n      // bibliography/html=STYLE 等合法格式。\n      const defaultSetting =\n        (Zotero.Prefs.get("export.quickCopy.setting") as string) || "";\n      const parsedSetting = (Zotero.QuickCopy as any).unserializeSetting(\n        defaultSetting,\n      );\n\n      if (parsedSetting?.mode === "bibliography" && parsedSetting?.id) {\n        const styleIdPart = parsedSetting.id;\n        format = `bibliography=${styleIdPart}`;\n        styleInfo = { isDefault: true, id: styleIdPart };\n      } else {\n        // 默认设置非引文格式，回退到 APA\n        const fallback = "http://www.zotero.org/styles/apa";\n        format = `bibliography=${fallback}`;\n        styleInfo = { isDefault: true, id: fallback, title: "APA (fallback)" };\n      }'''
service = replace_once(service, old_default, new_default, "default QuickCopy parser")
service = replace_once(
    service,
    "          items,\n          format,\n          lib,\n          asCitations,",
    "          items,\n          format,\n          undefined,\n          asCitations,",
    "QuickCopy callback argument",
)
SERVICE.write_text(service, encoding="utf-8")

# 2) Keep cookjohn current server as the base. Add only sync_bib/cite and its safety gate
# from the reviewed split; do not import cloneorcopy's external-tool registry or semantic UI.
review_server = run("git", "show", f"{REVIEW_REF}:zotero-mcp-plugin/src/modules/streamableMCPServer.ts")
target = SERVER.read_text(encoding="utf-8")

const_line = "const CITATION_FILE_TOOLS_PREF = 'extensions.zotero.zotero-mcp-plugin.citationFiles.enabled';\n"
if const_line not in target:
    import_marker = "import { CitationExportService } from './citationExportService';\n"
    if target.count(import_marker) != 1:
        raise RuntimeError("citation service import marker not unique")
    target = target.replace(import_marker, import_marker + "\n" + const_line, 1)

sync_defs = extract(
    review_server,
    "      {\n        name: 'sync_bib'",
    "    ];",
    "sync/cite tool definitions",
)
insert_after_style = "      {\n        name: 'list_citation_styles'"
idx = target.index(insert_after_style)
list_end = target.index("    ];", idx)
target = target[:list_end] + sync_defs + target[list_end:]

citation_filter = extract(
    review_server,
    "    // File-editing citation tools have their own default-off safety gate.",
    "    // Filter out write tools if write operations are disabled (default: disabled)",
    "citation tools/list filter",
)
write_marker = "    // Filter out write tools if write operations are disabled (default: disabled)"
if target.count(write_marker) != 1:
    raise RuntimeError("write filter marker not unique")
target = target.replace(write_marker, citation_filter + write_marker, 1)
# Preserve cookjohn's current write-tool filtering by only changing its input from filteredTools.
old_final = "    const finalTools = writeEnabled === true\n      ? filteredTools\n      : filteredTools.filter((t: any) => !writeToolNames.has(t.name));"
new_final = "    const finalTools = writeEnabled === true\n      ? citationFilteredTools\n      : citationFilteredTools.filter((t: any) => !writeToolNames.has(t.name));"
target = replace_once(target, old_final, new_final, "citation-filter composition")

cases = extract(
    review_server,
    "        case 'sync_bib': {",
    "        default: {",
    "sync/cite call cases",
)
case_marker = "        case 'list_citation_styles':\n          result = await this.callListCitationStyles(args);\n          break;\n"
if target.count(case_marker) != 1:
    raise RuntimeError("list citation styles case not unique")
target = target.replace(case_marker, case_marker + "\n" + cases, 1)

assert_method = extract(
    review_server,
    "  private assertCitationFileToolsEnabled(): void {",
    "  private citationExportService: CitationExportService | null = null;",
    "citation safety assertion",
)
citation_field = "  private citationExportService: CitationExportService | null = null;"
if target.count(citation_field) != 1:
    raise RuntimeError("citation service field not unique")
target = target.replace(citation_field, assert_method + citation_field, 1)

sync_methods = extract(
    review_server,
    "  /**\n   * 【功能 3】同步导出整个 Zotero 文献库到 .bib 文件。",
    "  // ============ Semantic Search Methods ============",
    "sync/cite wrapper methods",
)
semantic_marker = "  // ============ Semantic Search Methods ============"
if target.count(semantic_marker) != 1:
    raise RuntimeError("semantic methods marker not unique")
target = target.replace(semantic_marker, sync_methods + semantic_marker, 1)
SERVER.write_text(target, encoding="utf-8")

# 3) Apply only the reviewed non-server safety delta from c616 -> safe-v2.
patch = subprocess.check_output(
    ["git", "diff", "--binary", BASE_SOURCE, REVIEW_REF, "--", *NON_CODE_PATHS],
    cwd=ROOT,
)
proc = subprocess.run(["git", "apply", "--3way", "-"], cwd=ROOT, input=patch)
if proc.returncode != 0:
    raise RuntimeError("failed to apply reviewed non-code safety delta")

# Scope guard relative to stacked base ①.
changed = run("git", "diff", "--name-only", "HEAD").splitlines()
untracked = run("git", "ls-files", "--others", "--exclude-standard").splitlines()
actual = sorted(set(changed + untracked))
if actual != EXPECTED:
    raise RuntimeError(f"Unexpected safe-citation scope: {actual}")

print("Prepared stacked split ② with reviewed safety behavior only")
