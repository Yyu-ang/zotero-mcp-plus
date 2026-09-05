import { StreamableMCPServer } from "../src/modules/streamableMCPServer";

declare const expect: Chai.ExpectStatic;

const PREF = "extensions.zotero.zotero-mcp-plugin.citationFiles.enabled";

describe("citation file MCP safety gate", function () {
  let previousValue: any;

  beforeEach(function () {
    (globalThis as any).ztoolkit = { log: () => undefined };
    previousValue = Zotero.Prefs.get(PREF, true);
  });

  afterEach(function () {
    if (previousValue === undefined || previousValue === null) {
      Zotero.Prefs.clear(PREF, true);
    } else {
      Zotero.Prefs.set(PREF, previousValue, true);
    }
  });

  it("hides sync_bib and cite unless explicitly enabled", function () {
    Zotero.Prefs.clear(PREF, true);
    const server = new StreamableMCPServer();
    let response = (server as any).handleToolsList({ id: 1 });
    let names = response.result.tools.map((tool: any) => tool.name);
    expect(names).to.not.include("sync_bib");
    expect(names).to.not.include("cite");

    Zotero.Prefs.set(PREF, true, true);
    response = (server as any).handleToolsList({ id: 2 });
    names = response.result.tools.map((tool: any) => tool.name);
    expect(names).to.include("sync_bib");
    expect(names).to.include("cite");
  });

  it("rejects direct tools/call attempts while disabled", async function () {
    Zotero.Prefs.set(PREF, false, true);
    const server = new StreamableMCPServer();
    const response = await (server as any).handleToolCall({
      id: 1,
      params: {
        name: "sync_bib",
        arguments: { bibPath: "/tmp/references.bib" },
      },
    });
    expect(response.error?.message).to.contain(
      "Citation file tools are disabled",
    );
  });
});
