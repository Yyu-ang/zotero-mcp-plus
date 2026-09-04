import { CitationExportService } from "../src/modules/citationExportService";

declare const expect: Chai.ExpectStatic;

const QUICK_COPY_PREF = "export.quickCopy.setting";

describe("CitationExportService", function () {
  beforeEach(function () {
    (globalThis as any).ztoolkit = { log: () => undefined };
  });

  it("maps Zotero item keys to BBT citation keys before export", async function () {
    const service = new CitationExportService();
    const calls: Array<{ method: string; params: any[] }> = [];

    (service as any).bbtRpc = async (method: string, params: any[]) => {
      calls.push({ method, params });
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
      {
        method: "item.citationkey",
        params: [["12:ABCD1234"]],
      },
      {
        method: "item.export",
        params: [["Doe2026"], "Better BibLaTeX", 12],
      },
    ]);
    expect(result.citationKeys).to.deep.equal(["Doe2026"]);
    expect(result.itemKeyToCitationKey).to.deep.equal({
      ABCD1234: "Doe2026",
    });
  });

  it("uses bibliography Quick Copy mode and the fourth argument for in-text citations", async function () {
    const service = new CitationExportService();
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Citation regression test");
    await item.saveTx({ skipNotifier: true });

    const quickCopy = Zotero.QuickCopy as any;
    const originalGetContentFromItems = quickCopy.getContentFromItems;
    let capturedArgs: any[] | undefined;

    quickCopy.getContentFromItems = (...args: any[]) => {
      capturedArgs = args;
      return {
        text: "(Test, 2026)",
        html: "<span>(Test, 2026)</span>",
      };
    };

    try {
      const result = await service.getCitation({
        itemKeys: [item.key],
        style: "apa",
        mode: "citation",
        contentType: "text",
      });

      expect(capturedArgs).to.not.equal(undefined);
      expect(capturedArgs![1].mode).to.equal("bibliography");
      expect(capturedArgs![2]).to.equal(undefined);
      expect(capturedArgs![3]).to.equal(true);
      expect(result.content).to.equal("(Test, 2026)");
    } finally {
      quickCopy.getContentFromItems = originalGetContentFromItems;
      await item.eraseTx({ skipNotifier: true });
    }
  });

  it("parses bibliography/html Quick Copy settings instead of falling back", async function () {
    const service = new CitationExportService();
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Quick Copy parsing test");
    await item.saveTx({ skipNotifier: true });

    const previousSetting = Zotero.Prefs.get(QUICK_COPY_PREF) as any;
    const testStyleID = "http://www.zotero.org/styles/review-test-style";
    Zotero.Prefs.set(QUICK_COPY_PREF, `bibliography/html=${testStyleID}`, true);

    const quickCopy = Zotero.QuickCopy as any;
    const originalGetContentFromItems = quickCopy.getContentFromItems;
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

      expect(capturedFormat.mode).to.equal("bibliography");
      expect(capturedFormat.contentType).to.equal("html");
      expect(capturedFormat.id).to.equal(testStyleID);
      expect(result.style).to.equal(testStyleID);
      expect(result.isDefaultStyle).to.equal(true);
    } finally {
      quickCopy.getContentFromItems = originalGetContentFromItems;
      if (previousSetting === undefined || previousSetting === null) {
        Zotero.Prefs.clear(QUICK_COPY_PREF);
      } else {
        Zotero.Prefs.set(QUICK_COPY_PREF, previousSetting, true);
      }
      await item.eraseTx({ skipNotifier: true });
    }
  });
});
