from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "zotero-mcp-plugin"
SERVICE = PLUGIN / "src/modules/citationExportService.ts"
SERVER = PLUGIN / "src/modules/streamableMCPServer.ts"
TEST = PLUGIN / "test/citationExportService.test.ts"

BASE_SOURCE = "c616d620427cbbd075d48caf6560ddd9c9f72728"
OLD_FEATURE_COMMIT = "33bddf6173a5c41479141f1d40d550f27ccba312"


def run(*args: str) -> str:
    return subprocess.check_output(args, cwd=ROOT, text=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


# Start from the already-reviewed three-tool integration skeleton.
subprocess.check_call(["git", "fetch", "origin", "pr92-bbt-export"], cwd=ROOT)
subprocess.check_call(["git", "cherry-pick", OLD_FEATURE_COMMIT], cwd=ROOT)

# Fetch cloneorcopy's final pre-review behavior as the source of truth.
try:
    subprocess.check_call(["git", "remote", "add", "cloneorcopy", "https://github.com/cloneorcopy/zotero-mcp-plus.git"], cwd=ROOT)
except subprocess.CalledProcessError:
    pass
subprocess.check_call(["git", "fetch", "cloneorcopy", "main"], cwd=ROOT)

source_service = run(
    "git", "show",
    f"{BASE_SOURCE}:zotero-mcp-plugin/src/modules/citationExportService.ts",
)
marker = "  // ============ sync-bib & cite Draft Methods ============"
if source_service.count(marker) != 1:
    raise RuntimeError("Could not isolate citation-only portion of cloneorcopy service")
service = source_service.split(marker, 1)[0].rstrip() + "\n}\n"

# Apply only the three QuickCopy fixes explicitly requested by cookjohn.
service = replace_once(
    service,
    "      format = `${mode}=${resolved.styleID}`;",
    "      format = `bibliography=${resolved.styleID}`;",
    "explicit style must use bibliography prefix",
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

# Restore the exact cloneorcopy tool definitions for the three citation tools only.
source_server = run(
    "git", "show",
    f"{BASE_SOURCE}:zotero-mcp-plugin/src/modules/streamableMCPServer.ts",
)
target_server = SERVER.read_text(encoding="utf-8")
start = "      {\n        name: 'export_bibliography'"
source_end = "      {\n        name: 'sync_bib'"
target_end = "    ];"
if source_server.count(start) != 1 or source_server.count(source_end) != 1:
    raise RuntimeError("Could not isolate cloneorcopy citation tool definitions")
source_tool_block = source_server[source_server.index(start):source_server.index(source_end)]
if target_server.count(start) != 1:
    raise RuntimeError("Could not find target citation tool definitions")
target_start_idx = target_server.index(start)
target_end_idx = target_server.index(target_end, target_start_idx)
target_server = target_server[:target_start_idx] + source_tool_block + target_server[target_end_idx:]

# Restore the exact cloneorcopy wrapper methods for the three citation tools only.
method_start = "  // ============ Citation & Bibliography Export Methods ============"
source_method_end = "  /**\n   * 【功能 3】同步导出整个 Zotero 文献库到 .bib 文件。"
target_method_end = "  // ============ Semantic Search Methods ============"
if source_server.count(method_start) != 1 or source_server.count(source_method_end) != 1:
    raise RuntimeError("Could not isolate cloneorcopy citation wrapper methods")
source_methods = source_server[source_server.index(method_start):source_server.index(source_method_end)]
if target_server.count(method_start) != 1 or target_server.count(target_method_end) != 1:
    raise RuntimeError("Could not isolate target citation wrapper methods")
tm_start = target_server.index(method_start)
tm_end = target_server.index(target_method_end, tm_start)
target_server = target_server[:tm_start] + source_methods + target_server[tm_end:]
SERVER.write_text(target_server, encoding="utf-8")

TEST.parent.mkdir(parents=True, exist_ok=True)
TEST.write_text(r'''import { CitationExportService } from "../src/modules/citationExportService";

declare const expect: Chai.ExpectStatic;

const QUICK_COPY_PREF = "export.quickCopy.setting";
const APA_STYLE = "http://www.zotero.org/styles/apa";

describe("CitationExportService", function () {
  beforeEach(function () {
    (globalThis as any).ztoolkit = { log: () => undefined };
  });

  it("keeps the original Better BibTeX export flow", async function () {
    const service = new CitationExportService();
    const calls: Array<{ method: string; params: any[] }> = [];

    (service as any).bbtRpc = async (method: string, params: any[]) => {
      calls.push({ method, params });
      if (method === "api.ready") {
        return { betterbibtex: "test", zotero: "7" };
      }
      if (method === "item.citationkey") {
        return { "12:ABCD1234": "Doe2026" };
      }
      if (method === "item.export") {
        return "@article{Doe2026, title={Example}}";
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    };

    const result = await service.exportBibliography({
      itemKeys: ["ABCD1234"],
      format: "biblatex",
      libraryID: 12,
    });

    expect(calls).to.deep.equal([
      { method: "api.ready", params: [] },
      { method: "item.citationkey", params: [["12:ABCD1234"]] },
      { method: "item.export", params: [["Doe2026"], "Better BibLaTeX", 12] },
    ]);
    expect(result.citationKeys).to.deep.equal(["Doe2026"]);
    expect(result.exportedCount).to.equal(1);
    expect(result.missingKeys).to.equal(undefined);
  });

  it("uses bibliography QuickCopy format and fourth argument for in-text citations", async function () {
    const service = new CitationExportService();
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Citation regression test");
    await item.saveTx({ skipNotifier: true });

    const quickCopy = Zotero.QuickCopy as any;
    const original = quickCopy.getContentFromItems;
    let capturedArgs: any[] | undefined;
    quickCopy.getContentFromItems = (...args: any[]) => {
      capturedArgs = args;
      return { text: "(Test, 2026)", html: "<span>(Test, 2026)</span>" };
    };

    try {
      const result = await service.getCitation({
        itemKeys: [item.key],
        style: APA_STYLE,
        mode: "citation",
        contentType: "text",
      });

      expect(capturedArgs).to.not.equal(undefined);
      expect(capturedArgs![1]).to.equal(`bibliography=${APA_STYLE}`);
      expect(capturedArgs![2]).to.equal(undefined);
      expect(capturedArgs![3]).to.equal(true);
      expect(result.content).to.equal("(Test, 2026)");
    } finally {
      quickCopy.getContentFromItems = original;
      await item.eraseTx({ skipNotifier: true });
    }
  });

  it("parses bibliography/html QuickCopy settings instead of falling back to APA", async function () {
    const service = new CitationExportService();
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Quick Copy parsing test");
    await item.saveTx({ skipNotifier: true });

    const previous = Zotero.Prefs.get(QUICK_COPY_PREF) as any;
    const testStyle = "http://www.zotero.org/styles/review-test-style";
    Zotero.Prefs.set(QUICK_COPY_PREF, `bibliography/html=${testStyle}`, true);

    const quickCopy = Zotero.QuickCopy as any;
    const original = quickCopy.getContentFromItems;
    let capturedFormat: any;
    quickCopy.getContentFromItems = (_items: any[], format: any) => {
      capturedFormat = format;
      return { text: "text", html: "<span>html</span>" };
    };

    try {
      const result = await service.getCitation({
        itemKeys: [item.key],
        mode: "bibliography",
        contentType: "html",
      });

      expect(capturedFormat).to.equal(`bibliography=${testStyle}`);
      expect(result.style).to.equal(testStyle);
      expect(result.content).to.equal("<span>html</span>");
    } finally {
      quickCopy.getContentFromItems = original;
      if (previous === undefined || previous === null) {
        Zotero.Prefs.clear(QUICK_COPY_PREF);
      } else {
        Zotero.Prefs.set(QUICK_COPY_PREF, previous, true);
      }
      await item.eraseTx({ skipNotifier: true });
    }
  });
});
''', encoding="utf-8")

# Scope guard: exactly three feature files.
changed = run("git", "diff", "--name-only", "HEAD").splitlines()
untracked = run("git", "ls-files", "--others", "--exclude-standard").splitlines()
actual = sorted(set(changed + untracked))
expected = sorted([
    "zotero-mcp-plugin/src/modules/citationExportService.ts",
    "zotero-mcp-plugin/src/modules/streamableMCPServer.ts",
    "zotero-mcp-plugin/test/citationExportService.test.ts",
])
if actual != expected:
    raise RuntimeError(f"Unexpected scope after patch: {actual}")

print("Prepared citation-only PR92 split with cloneorcopy behavior + QuickCopy fixes")
