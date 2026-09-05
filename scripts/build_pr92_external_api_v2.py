from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "zotero-mcp-plugin"
SOURCE_PARENT = "06ec226742f9e1da71c007047abee85aaa1d9ab2"
SOURCE_COMMIT = "42cd4c6567b90425952f19222b0edc8c19e71b41"
REVIEW_REF = "origin/review/pr92-external-tool-api-v2"
BASE = "5b0640f0f39f9ecaaeaa76bbf7c43f76bcef9599"
REGISTRY = PLUGIN / "src/modules/toolRegistry.ts"
SERVER = PLUGIN / "src/modules/streamableMCPServer.ts"
TEST = PLUGIN / "test/externalToolRegistry.test.ts"

EXPECTED = sorted([
    "README-zh.md",
    "README.md",
    "zotero-mcp-plugin/src/addon.ts",
    "zotero-mcp-plugin/src/hooks.ts",
    "zotero-mcp-plugin/src/modules/externalToolExample.ts",
    "zotero-mcp-plugin/src/modules/streamableMCPServer.ts",
    "zotero-mcp-plugin/src/modules/toolRegistry.ts",
    "zotero-mcp-plugin/test/externalToolRegistry.test.ts",
    "zotero-mcp-plugin/typings/zotero-mcp-api.d.ts",
])
TEMP = {
    ".github/workflows/tmp-pr92-external-tool-api-v2.yml",
    "scripts/build_pr92_external_api_v2.py",
}


def run(*args: str) -> str:
    return subprocess.check_output(args, cwd=ROOT, text=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


try:
    subprocess.check_call(["git", "remote", "add", "cloneorcopy", "https://github.com/cloneorcopy/zotero-mcp-plus.git"], cwd=ROOT)
except subprocess.CalledProcessError:
    pass
subprocess.check_call(["git", "fetch", "cloneorcopy", "main"], cwd=ROOT)
subprocess.check_call(["git", "fetch", "origin", "review/pr92-external-tool-api-v2"], cwd=ROOT)

# Apply cloneorcopy's original external-API commit without replacing cookjohn's
# later streamableMCPServer changes. The four modified non-server files merge
# cleanly as a 3-way patch; the three new files are copied exactly.
modified_non_server = [
    "README.md",
    "README-zh.md",
    "zotero-mcp-plugin/src/addon.ts",
    "zotero-mcp-plugin/src/hooks.ts",
]
patch = subprocess.check_output(
    ["git", "diff", "--binary", SOURCE_PARENT, SOURCE_COMMIT, "--", *modified_non_server],
    cwd=ROOT,
)
proc = subprocess.run(["git", "apply", "--3way", "-"], cwd=ROOT, input=patch)
if proc.returncode != 0:
    raise RuntimeError("failed to apply original external API non-server patch")

for rel in [
    "zotero-mcp-plugin/src/modules/externalToolExample.ts",
    "zotero-mcp-plugin/src/modules/toolRegistry.ts",
    "zotero-mcp-plugin/typings/zotero-mcp-api.d.ts",
]:
    dest = ROOT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(run("git", "show", f"{SOURCE_COMMIT}:{rel}"), encoding="utf-8")

# Reproduce only the three server integration points from the original commit.
server = SERVER.read_text(encoding="utf-8")
import_marker = "import { getSemanticSearchService, SemanticSearchService } from './semantic';\n"
if "import { getToolRegistry } from './toolRegistry';" not in server:
    server = replace_once(
        server,
        import_marker,
        import_marker + "import { getToolRegistry } from './toolRegistry';\n",
        "tool registry import",
    )

return_marker = "    return this.createResponse(request.id ?? null, { tools: finalTools });"
external_list_block = '''    // Append externally-registered tools from other Zotero plugins\n    const externalTools = getToolRegistry().getToolDefinitions();\n    if (externalTools.length > 0) {\n      (finalTools as any[]).push(...externalTools);\n    }\n\n'''
if external_list_block.strip() not in server:
    server = replace_once(
        server,
        return_marker,
        external_list_block + return_marker,
        "external tools/list integration",
    )

old_default = '''        default:\n          throw new Error(`Unknown tool: ${name}`);'''
new_default = '''        default: {\n          // Check externally-registered tools from other Zotero plugins\n          const registry = getToolRegistry();\n          const externalTool = registry.getTool(name);\n          if (externalTool) {\n            ztoolkit.log(`[StreamableMCP] Calling external tool: ${name}`);\n            result = await externalTool.handler(args);\n            break;\n          }\n          throw new Error(`Unknown tool: ${name}`);\n        }'''
server = replace_once(server, old_default, new_default, "external handler dispatch")
SERVER.write_text(server, encoding="utf-8")

# Maintainer review: reserve citation-file tool names without changing the API.
registry = REGISTRY.read_text(encoding="utf-8")
needle = "  'list_citation_styles',\n]);"
replacement = "  'list_citation_styles',\n  'sync_bib',\n  'cite',\n]);"
if registry.count(needle) != 1:
    raise RuntimeError("BUILTIN_TOOL_NAMES insertion point not unique")
registry = registry.replace(needle, replacement, 1)
REGISTRY.write_text(registry, encoding="utf-8")

TEST.parent.mkdir(parents=True, exist_ok=True)
TEST.write_text(
    run("git", "show", f"{REVIEW_REF}:zotero-mcp-plugin/test/externalToolRegistry.test.ts"),
    encoding="utf-8",
)

registry = REGISTRY.read_text(encoding="utf-8")
types = (PLUGIN / "typings/zotero-mcp-api.d.ts").read_text(encoding="utf-8")
for token in [
    "pluginID?: string",
    "registerTool(def: ExternalToolDefinition): boolean",
    "unregisterTool(name: string): boolean",
    "'sync_bib'",
    "'cite'",
]:
    if token not in registry:
        raise RuntimeError(f"registry compatibility invariant missing: {token}")
for token in [
    "pluginID?: string",
    "registerTool(def: MCPToolDefinition): boolean",
    "unregisterTool(name: string): boolean",
]:
    if token not in types:
        raise RuntimeError(f"public typing invariant missing: {token}")
for forbidden in ["externalTools.enabled", "RegistrationHandle", "unregisterTool(name: string, pluginID"]:
    if forbidden in registry or forbidden in types:
        raise RuntimeError(f"discarded external API redesign leaked in: {forbidden}")

server = SERVER.read_text(encoding="utf-8")
for token in [
    "getToolRegistry",
    "getToolDefinitions()",
    "externalTool.handler(args)",
    "'add_by_identifier'",
    "runSerializedWrite",
]:
    if token not in server:
        raise RuntimeError(f"server integration/current-upstream invariant missing: {token}")

all_changed = run("git", "diff", "--name-only", BASE).splitlines()
untracked = run("git", "ls-files", "--others", "--exclude-standard").splitlines()
actual = sorted({p for p in all_changed + untracked if p not in TEMP})
if actual != EXPECTED:
    raise RuntimeError(f"Unexpected external API split scope: {actual}")

print("Prepared original cloneorcopy external tool API with current upstream server and reserved citation names")
