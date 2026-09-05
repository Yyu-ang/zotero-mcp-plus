from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "zotero-mcp-plugin"
SOURCE_COMMIT = "42cd4c6567b90425952f19222b0edc8c19e71b41"
REVIEW_REF = "origin/review/pr92-external-tool-api-v2"
BASE = "5b0640f0f39f9ecaaeaa76bbf7c43f76bcef9599"
REGISTRY = PLUGIN / "src/modules/toolRegistry.ts"
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


try:
    subprocess.check_call(["git", "remote", "add", "cloneorcopy", "https://github.com/cloneorcopy/zotero-mcp-plus.git"], cwd=ROOT)
except subprocess.CalledProcessError:
    pass
subprocess.check_call(["git", "fetch", "cloneorcopy", "main"], cwd=ROOT)
subprocess.check_call(["git", "fetch", "origin", "review/pr92-external-tool-api-v2"], cwd=ROOT)

# Reuse cloneorcopy's own original external-tool API commit. No API redesign.
subprocess.check_call(["git", "cherry-pick", SOURCE_COMMIT], cwd=ROOT)

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

# Compatibility invariants: preserve cloneorcopy's original public API.
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

# Explicitly reject our discarded redesign.
for forbidden in ["externalTools.enabled", "RegistrationHandle", "unregisterTool(name: string, pluginID"]:
    if forbidden in registry or forbidden in types:
        raise RuntimeError(f"discarded external API redesign leaked in: {forbidden}")

all_changed = run("git", "diff", "--name-only", BASE).splitlines()
untracked = run("git", "ls-files", "--others", "--exclude-standard").splitlines()
actual = sorted({p for p in all_changed + untracked if p not in TEMP})
if actual != EXPECTED:
    raise RuntimeError(f"Unexpected external API split scope: {actual}")

print("Prepared original cloneorcopy external tool API with reserved citation names")
