import { CitationExportService } from "../src/modules/citationExportService";

declare const expect: Chai.ExpectStatic;

describe("CitationExportService QuickCopy regression", function () {
  const styleID = "http://www.zotero.org/styles/apa";
  let originalItemLookup: any;
  let originalStyleGet: any;
  let originalQuickCopyGet: any;
  let originalUnserialize: any;
  let originalPrefsGet: any;

  beforeEach(function () {
    (globalThis as any).ztoolkit = { log: () => undefined };
    originalItemLookup = (Zotero.Items as any).getByLibraryAndKeyAsync;
    originalStyleGet = (Zotero.Styles as any).get;
    originalQuickCopyGet = (Zotero.QuickCopy as any).getContentFromItems;
    originalUnserialize = (Zotero.QuickCopy as any).unserializeSetting;
    originalPrefsGet = (Zotero.Prefs as any).get;

    (Zotero.Items as any).getByLibraryAndKeyAsync = async () => ({
      id: 1,
      isAttachment: () => false,
      isNote: () => false,
    });
    (Zotero.Styles as any).get = () => ({
      styleID,
      title: "APA",
      hasBibliography: true,
    });
  });

  afterEach(function () {
    (Zotero.Items as any).getByLibraryAndKeyAsync = originalItemLookup;
    (Zotero.Styles as any).get = originalStyleGet;
    (Zotero.QuickCopy as any).getContentFromItems = originalQuickCopyGet;
    (Zotero.QuickCopy as any).unserializeSetting = originalUnserialize;
    (Zotero.Prefs as any).get = originalPrefsGet;
  });

  it("uses bibliography mode, callback slot undefined, and fourth arg for in-text citations", async function () {
    let captured: any[] | undefined;
    (Zotero.QuickCopy as any).getContentFromItems = (...args: any[]) => {
      captured = args;
      return { text: "(Test, 2026)", html: "<span>(Test, 2026)</span>" };
    };

    const result = await new CitationExportService().getCitation({
      itemKeys: ["ABCD1234"],
      style: "apa",
      mode: "citation",
      contentType: "text",
    });

    expect(captured).to.not.equal(undefined);
    expect(captured![1]).to.equal(`bibliography=${styleID}`);
    expect(captured![2]).to.equal(undefined);
    expect(captured![3]).to.equal(true);
    expect(result.content).to.equal("(Test, 2026)");
  });

  it("parses bibliography/html default QuickCopy settings with unserializeSetting", async function () {
    const setting = `bibliography/html=${styleID}`;
    let unserializedInput: unknown;
    let captured: any[] | undefined;

    (Zotero.Prefs as any).get = (key: string, ...args: any[]) => {
      if (key === "export.quickCopy.setting") return setting;
      return originalPrefsGet.call(Zotero.Prefs, key, ...args);
    };
    (Zotero.QuickCopy as any).unserializeSetting = (value: unknown) => {
      unserializedInput = value;
      return {
        mode: "bibliography",
        contentType: "html",
        id: styleID,
        locale: "",
      };
    };
    (Zotero.QuickCopy as any).getContentFromItems = (...args: any[]) => {
      captured = args;
      return { text: "Reference", html: "<span>Reference</span>" };
    };

    const result = await new CitationExportService().getCitation({
      itemKeys: ["ABCD1234"],
      mode: "bibliography",
      contentType: "html",
    });

    expect(unserializedInput).to.equal(setting);
    expect(captured![1]).to.equal(`bibliography=${styleID}`);
    expect(captured![2]).to.equal(undefined);
    expect(captured![3]).to.equal(false);
    expect(result.style).to.equal(styleID);
    expect(result.content).to.equal("<span>Reference</span>");
  });
});
