import { StreamableMCPServer } from "../src/modules/streamableMCPServer";

declare const expect: Chai.ExpectStatic;

const CITATION_FILE_TOOLS_PREF =
  "extensions.zotero.zotero-mcp-plugin.citationFiles.enabled";

describe("citation file MCP safety gate", function () {
  let previousValue: any;

  beforeEach(function () {
    (globalThis as any).ztoolkit = { log: () => undefined };
    previousValue = Zotero.Prefs.get(CITATION_FILE_TOOLS_PREF, true);
  });

  afterEach(function () {
    if (previousValue === undefined || previousValue === null) {
      Zotero.Prefs.clear(CITATION_FILE_TOOLS_PREF, true);
    } else {
      Zotero.Prefs.set(CITATION_FILE_TOOLS_PREF, previousValue, true);
    }
  });

  it("hides sync_bib and cite when the gate is disabled", function () {
    Zotero.Prefs.set(CITATION_FILE_TOOLS_PREF, false, true);
    const server = new StreamableMCPServer();
    const response = (server as any).handleToolsList({ id: 1 });
    const names = response.result.tools.map((tool: any) => tool.name);

    expect(names).to.not.include("sync_bib");
    expect(names).to.not.include("cite");
  });

  it("shows sync_bib and cite only when explicitly enabled", function () {
    Zotero.Prefs.set(CITATION_FILE_TOOLS_PREF, true, true);
    const server = new StreamableMCPServer();
    const response = (server as any).handleToolsList({ id: 1 });
    const names = response.result.tools.map((tool: any) => tool.name);

    expect(names).to.include("sync_bib");
    expect(names).to.include("cite");
  });

  it("rejects direct tools/call attempts while disabled", async function () {
    Zotero.Prefs.set(CITATION_FILE_TOOLS_PREF, false, true);
    const server = new StreamableMCPServer();
    const response = await (server as any).handleToolCall({
      id: 1,
      params: {
        name: "sync_bib",
        arguments: { bibPath: "/tmp/references.bib" },
      },
    });

    expect(response.error).to.not.equal(undefined);
    expect(response.error.message).to.contain(
      "Citation file tools are disabled",
    );
  });
});
