import { expect } from "chai";
import {
  buildCollectionName,
  buildKeywordConditions,
  clampScore,
  configureKeywordSearch,
  createSearchSequencer,
  formatScore,
  highlightSegments,
  intersectResults,
  mergeResults,
  sortResults,
  unionResults,
  windowSnippet,
  type DialogResult,
} from "../src/modules/semantic/dialogResults.ts";

function result(
  itemKey: string,
  score: number,
  extra: Partial<DialogResult> = {},
): DialogResult {
  return { itemKey, title: `Title ${itemKey}`, score, ...extra };
}

describe("semantic dialog result helpers", function () {
  describe("clampScore / formatScore", function () {
    it("keeps in-range scores unchanged", function () {
      expect(clampScore(0)).to.equal(0);
      expect(clampScore(0.5)).to.equal(0.5);
      expect(clampScore(1)).to.equal(1);
    });

    it("clamps the hybrid score that used to render above 100%", function () {
      // The old merge did Math.max(score, 0.6) + 0.1 repeatedly, so a row
      // matched by both modes could end up at 1.2 and the table showed 120%.
      expect(clampScore(1.2)).to.equal(1);
      expect(formatScore(1.2)).to.equal("100%");
      expect(formatScore(-0.5)).to.equal("0%");
    });

    it("treats non-finite scores as zero", function () {
      expect(clampScore(Number.NaN)).to.equal(0);
      expect(clampScore(Number.POSITIVE_INFINITY)).to.equal(0);
      expect(formatScore(Number.NaN)).to.equal("0%");
    });
  });

  describe("mergeResults", function () {
    it("flags rows found by a single mode", function () {
      const merged = mergeResults([result("a", 0.8)], [result("b", 0.5)]);
      expect(merged.map((r) => r.itemKey).sort()).to.deep.equal(["a", "b"]);
      expect(merged.find((r) => r.itemKey === "a")?.sources).to.deep.equal([
        "semantic",
      ]);
      expect(merged.find((r) => r.itemKey === "b")?.sources).to.deep.equal([
        "keyword",
      ]);
    });

    it("flags a row found by both modes, merges chunks and caps the score", function () {
      const merged = mergeResults(
        [
          result("a", 0.7, {
            matchedChunks: [{ chunkId: 0, text: "semantic chunk" }],
          }),
        ],
        [
          result("a", 0.5, {
            matchedChunks: [{ chunkId: 1, text: "keyword chunk" }],
          }),
        ],
      );

      expect(merged).to.have.length(1);
      expect(merged[0].sources).to.deep.equal(["semantic", "keyword"]);
      expect(merged[0].matchedChunks?.map((c) => c.chunkId)).to.deep.equal([
        0, 1,
      ]);
      expect(merged[0].score).to.be.at.most(1);
    });

    it("sorts merged rows by score descending", function () {
      const merged = mergeResults(
        [result("low", 0.2), result("high", 0.9)],
        [],
      );
      expect(merged.map((r) => r.itemKey)).to.deep.equal(["high", "low"]);
    });

    it("ignores rows without an item key", function () {
      expect(mergeResults([result("", 0.5)], [result("a", 0.4)])).to.deep.equal(
        [result("a", 0.4, { sources: ["keyword"] })],
      );
    });
  });

  describe("intersectResults", function () {
    const first = [result("a", 0.9), result("b", 0.5)];
    const second = [result("a", 0.4), result("c", 0.6)];

    it("keeps only keys present in every list and combines scores", function () {
      const rows = intersectResults([first, second], "min");
      expect(rows.map((r) => r.itemKey)).to.deep.equal(["a"]);
      expect(rows[0].score).to.equal(0.4);
      expect(rows[0].sources).to.deep.equal(["both"]);
    });

    it("supports the product and average formulas", function () {
      expect(
        intersectResults([first, second], "product")[0].score,
      ).to.be.closeTo(0.36, 1e-9);
      expect(intersectResults([first, second], "average")[0].score).to.equal(
        0.65,
      );
    });

    it("clamps combined scores that arrive out of range", function () {
      expect(
        intersectResults([[result("a", 1.4)], [result("a", 0.9)]], "average")[0]
          .score,
      ).to.equal(1);
    });

    it("returns an empty list when the lists share no key", function () {
      expect(intersectResults([[result("a", 0.9)]], "min")).to.deep.equal([
        { ...result("a", 0.9), sources: ["both"], matchedChunks: [] },
      ]);
      expect(
        intersectResults([[result("a", 0.9)], [result("b", 0.9)]], "min"),
      ).to.deep.equal([]);
      expect(intersectResults([], "min")).to.deep.equal([]);
    });
  });

  describe("unionResults", function () {
    it("collapses duplicates and keeps the first occurrence's metadata", function () {
      const rows = unionResults([
        [result("a", 0.9, { title: "first" }), result("b", 0.4)],
        [result("a", 0.2, { title: "second" })],
      ]);
      expect(rows).to.have.length(2);
      expect(rows.find((r) => r.itemKey === "a")?.title).to.equal("first");
      expect(rows.map((r) => r.itemKey)).to.deep.equal(["a", "b"]);
    });
  });

  describe("sortResults", function () {
    const rows = [
      result("a", 0.2, { title: "Bravo", creators: "Doe", year: 2001 }),
      result("b", 0.9, { title: "Alpha", creators: "Adams", year: 1999 }),
      result("c", 0.5, { title: "Charlie", creators: "Zeed", year: 2010 }),
    ];

    it("sorts by score descending", function () {
      expect(
        sortResults(rows, "similarity", -1).map((r) => r.itemKey),
      ).to.deep.equal(["b", "c", "a"]);
    });

    it("sorts text columns case-insensitively", function () {
      expect(sortResults(rows, "title", 1).map((r) => r.itemKey)).to.deep.equal(
        ["b", "a", "c"],
      );
      expect(
        sortResults(rows, "authors", 1).map((r) => r.itemKey),
      ).to.deep.equal(["b", "a", "c"]);
    });

    it("sorts by year and treats a missing year as zero", function () {
      expect(sortResults(rows, "year", 1).map((r) => r.itemKey)).to.deep.equal([
        "b",
        "a",
        "c",
      ]);
      expect(
        sortResults([result("none", 0.5), ...rows], "year", 1).map(
          (r) => r.itemKey,
        ),
      ).to.deep.equal(["none", "b", "a", "c"]);
    });

    it("does not mutate the input list", function () {
      const original = [...rows];
      sortResults(rows, "similarity", -1);
      expect(rows).to.deep.equal(original);
    });
  });

  describe("keyword search conditions", function () {
    it("matches title, creator, tag and abstract with literal contains", function () {
      const conditions = buildKeywordConditions("quantum");
      expect(conditions).to.deep.equal([
        { field: "title", operator: "contains", value: "quantum" },
        { field: "creator", operator: "contains", value: "quantum" },
        { field: "tag", operator: "contains", value: "quantum" },
        { field: "abstractNote", operator: "contains", value: "quantum" },
      ]);
    });

    it("does not add an itemType condition", function () {
      // `itemType isNot attachment` was ORed with the literal terms, so it
      // matched every non-attachment item and keyword mode ignored the query.
      expect(buildKeywordConditions("x").map((c) => c.field)).to.not.include(
        "itemType",
      );
    });

    it("trims the query and passes it to the search builder", function () {
      const added: Array<[string, string, string]> = [];
      configureKeywordSearch(
        {
          addCondition(field, operator, value) {
            added.push([field, operator, value]);
          },
        },
        "  quantum  ",
      );
      expect(added).to.deep.equal([
        ["title", "contains", "quantum"],
        ["creator", "contains", "quantum"],
        ["tag", "contains", "quantum"],
        ["abstractNote", "contains", "quantum"],
      ]);
    });
  });

  describe("buildCollectionName", function () {
    it("joins the queries behind the collection label", function () {
      expect(
        buildCollectionName("Save Results as Collection", ["a", "b"]),
      ).to.equal("Save Results as Collection: a / b");
    });

    it("truncates over-long names to the maximum length", function () {
      const name = buildCollectionName(
        "Save Results as Collection",
        ["one", "two"],
        10,
      );
      expect(name).to.have.length(10);
      expect(name).to.equal("Save Resul");
    });
  });

  describe("windowSnippet", function () {
    it("returns short text unchanged", function () {
      expect(windowSnippet("short text", 360, [])).to.equal("short text");
    });

    it("collapses whitespace and appends an ellipsis when truncated", function () {
      const text = "alpha ".repeat(50);
      const snippet = windowSnippet(text, 40, []);
      expect(snippet).to.have.length(41);
      expect(snippet.startsWith("\u2026")).to.equal(false);
      expect(snippet.endsWith("\u2026")).to.equal(true);
      expect(snippet).to.not.include("  ");
    });

    it("centers the window on the first highlighted term", function () {
      const text = "start ".repeat(30) + "needle" + " tail ".repeat(30);
      const snippet = windowSnippet(text, 60, ["needle"]);
      expect(snippet.toLowerCase()).to.include("needle");
      expect(snippet.startsWith("\u2026")).to.equal(true);
    });

    it("does not shift the window when the term is already near the start", function () {
      const text = "needle" + " tail ".repeat(30);
      const snippet = windowSnippet(text, 60, ["needle"]);
      expect(snippet.toLowerCase()).to.include("needle");
      expect(snippet.startsWith("\u2026")).to.equal(false);
    });
  });

  describe("highlightSegments", function () {
    it("marks a literal term", function () {
      expect(
        highlightSegments("the quantum method", ["quantum"]),
      ).to.deep.equal([
        { text: "the ", marked: false },
        { text: "quantum", marked: true },
        { text: " method", marked: false },
      ]);
    });

    it("keeps entity-looking terms as data instead of markup", function () {
      // The chunk used to be escaped and then regexed, so a term like `amp`
      // matched the `&amp;` entity and the inserted <mark> broke the tooltip.
      // Segments are consumed as textContent, so the text survives verbatim.
      const segments = highlightSegments("a &amp; b", ["amp"]);
      expect(segments.map((s) => s.text).join("")).to.equal("a &amp; b");
      expect(segments.some((s) => s.marked && s.text === "amp")).to.equal(true);
    });

    it("keeps markup characters in the chunk as data", function () {
      const segments = highlightSegments("<b>bold</b>", ["bold"]);
      expect(segments.map((s) => s.text).join("")).to.equal("<b>bold</b>");
      expect(segments.some((s) => s.marked && s.text === "bold")).to.equal(
        true,
      );
    });

    it("does not mark a term inside a longer word", function () {
      expect(highlightSegments("annotation", ["note"])).to.deep.equal([
        { text: "annotation", marked: false },
      ]);
    });

    it("merges overlapping terms into a single mark", function () {
      expect(
        highlightSegments("the quantum method", ["quantum", "the quantum"]),
      ).to.deep.equal([
        { text: "the quantum", marked: true },
        { text: " method", marked: false },
      ]);
    });

    it("marks CJK terms without word boundaries", function () {
      expect(highlightSegments("语义搜索结果", ["搜索"])).to.deep.equal([
        { text: "语义", marked: false },
        { text: "搜索", marked: true },
        { text: "结果", marked: false },
      ]);
    });

    it("returns the whole text unmarked without terms", function () {
      expect(highlightSegments("plain text", [])).to.deep.equal([
        { text: "plain text", marked: false },
      ]);
      expect(highlightSegments("plain text", ["a", "the"])).to.deep.equal([
        { text: "plain text", marked: false },
      ]);
    });

    it("reconstructs the original text from the segments", function () {
      for (const [text, terms] of [
        ["a &amp; b", ["amp"]],
        ["the quantum method", ["quantum"]],
        ["语义搜索结果", ["搜索"]],
      ] as const) {
        const rebuilt = highlightSegments(text, terms)
          .map((segment) => segment.text)
          .join("");
        expect(rebuilt).to.equal(text);
      }
    });
  });

  describe("createSearchSequencer", function () {
    it("accepts only the most recent token", function () {
      const sequencer = createSearchSequencer();
      const first = sequencer.next();
      const second = sequencer.next();
      expect(first).to.not.equal(second);
      expect(sequencer.isCurrent(first)).to.equal(false);
      expect(sequencer.isCurrent(second)).to.equal(true);
    });

    it("lets an older request discard itself once a newer one started", function () {
      const sequencer = createSearchSequencer();
      const stale = sequencer.next();
      const current = sequencer.next();
      const staleArrived = sequencer.isCurrent(stale);
      const currentArrived = sequencer.isCurrent(current);
      expect(staleArrived).to.equal(false);
      expect(currentArrived).to.equal(true);
    });
  });
});
