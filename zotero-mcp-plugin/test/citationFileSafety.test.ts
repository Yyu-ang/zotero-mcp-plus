import {
  assertSafeCitationFilePath,
  getPathExtension,
  isAbsoluteFilePath,
} from "../src/modules/citationFileSafety";

declare const expect: Chai.ExpectStatic;

describe("citation file path safety", function () {
  it("accepts POSIX, Windows drive, and UNC absolute paths", function () {
    expect(isAbsoluteFilePath("/tmp/references.bib")).to.equal(true);
    expect(isAbsoluteFilePath("C:\\papers\\references.bib")).to.equal(true);
    expect(isAbsoluteFilePath("\\\\server\\share\\references.bib")).to.equal(
      true,
    );
  });

  it("rejects relative paths", function () {
    expect(isAbsoluteFilePath("references.bib")).to.equal(false);
    expect(isAbsoluteFilePath("../references.bib")).to.equal(false);
  });

  it("normalizes extensions case-insensitively", function () {
    expect(getPathExtension("C:\\papers\\REFERENCES.BIB")).to.equal(".bib");
    expect(getPathExtension("/tmp/draft.MarkDown")).to.equal(".markdown");
  });

  it("enforces the extension allowlist", function () {
    expect(
      assertSafeCitationFilePath("/tmp/references.bib", [".bib"], "bibPath"),
    ).to.equal("/tmp/references.bib");

    expect(() =>
      assertSafeCitationFilePath("/tmp/references.txt", [".bib"], "bibPath"),
    ).to.throw("bibPath must use one of these extensions: .bib");
  });

  it("rejects empty and null-byte paths", function () {
    expect(() => assertSafeCitationFilePath("", [".bib"], "bibPath")).to.throw(
      "bibPath must be a non-empty absolute file path",
    );
    expect(() =>
      assertSafeCitationFilePath("/tmp/a\0.bib", [".bib"], "bibPath"),
    ).to.throw("bibPath contains an invalid null byte");
  });
});
