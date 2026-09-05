import { CitationExportService } from "../src/modules/citationExportService";

declare const expect: Chai.ExpectStatic;
declare const IOUtils: any;

describe("citation file behavior preservation", function () {
  let originalExists: any;
  let originalRead: any;
  let originalWrite: any;

  beforeEach(function () {
    (globalThis as any).ztoolkit = { log: () => undefined };
    originalExists = IOUtils.exists;
    originalRead = IOUtils.readUTF8;
    originalWrite = IOUtils.writeUTF8;
  });

  afterEach(function () {
    IOUtils.exists = originalExists;
    IOUtils.readUTF8 = originalRead;
    IOUtils.writeUTF8 = originalWrite;
  });

  it("preserves CSL-JSON sync format and forwards a configurable BBT timeout", async function () {
    const service: any = new CitationExportService();
    service.getAllItemKeys = async () => ["ABCD1234"];
    let captured: any;
    service.exportBibliography = async (params: any) => {
      captured = params;
      return { content: "[]", exportedCount: 1, missingKeys: undefined };
    };
    IOUtils.exists = async () => false;
    IOUtils.writeUTF8 = async () => undefined;

    const result = await service.syncBibFile({
      bibPath: "/tmp/references.bib",
      format: "csljson",
      timeoutMs: 90000,
    });

    expect(captured.format).to.equal("csljson");
    expect(captured.timeoutMs).to.equal(90000);
    expect(result.format).to.equal("csljson");
  });

  it("protects existing sync output unless overwrite=true", async function () {
    const service: any = new CitationExportService();
    IOUtils.exists = async () => true;
    let failed = false;
    try {
      await service.syncBibFile({ bibPath: "/tmp/references.bib" });
    } catch (error) {
      failed = true;
      expect(String(error)).to.contain(
        "Refusing to overwrite existing bibliography",
      );
    }
    expect(failed).to.equal(true);
  });

  it("keeps itemKey precedence, implicit append, and missing-draft creation", async function () {
    const service: any = new CitationExportService();
    let finderArgs: any[] | undefined;
    service.findItemByKeyOrQuery = async (...args: any[]) => {
      finderArgs = args;
      return { key: "ABCD1234", getField: () => "Title" };
    };
    service.exportBibliography = async () => ({
      content: "@article{CiteKey,\n  title={Title}\n}",
      citationKeys: ["CiteKey"],
    });
    IOUtils.exists = async () => false;
    IOUtils.readUTF8 = async () => "";
    const writes: Array<[string, string]> = [];
    IOUtils.writeUTF8 = async (path: string, content: string) => {
      writes.push([path, content]);
    };

    const result = await service.citeInDraft({
      itemKey: "ABCD1234",
      query: "also supplied",
      bibPath: "/tmp/references.bib",
      texPath: "/tmp/draft.tex",
    });

    expect(finderArgs?.[0]).to.equal("ABCD1234");
    expect(finderArgs?.[1]).to.equal("also supplied");
    expect(
      writes.some(
        ([path, content]) =>
          path === "/tmp/draft.tex" && content === "\\cite{CiteKey}\n",
      ),
    ).to.equal(true);
    expect(result.inserted).to.equal("\\cite{CiteKey}");
    expect(result.item_key).to.equal("ABCD1234");
  });
});
