/**
 * Pure result-combination, sorting, keyword-query and snippet helpers for the
 * semantic search dialog (`addon/content/searchDialog.xhtml`).
 *
 * The dialog builds its own result rows and needs to OR/AND several per-query
 * result lists, sort them and render snippet tooltips. That logic is kept here
 * — free of Zotero and DOM globals — so the dialog can receive it as a window
 * argument (like `VirtualizedTableHelper`) and the unit tests in
 * `test/dialogResults.test.ts` can exercise it directly.
 *
 * Pure on purpose: no Zotero globals, so it stays unit-testable.
 */

/** A chunk of indexed text, as returned by the semantic search service. */
export interface DialogChunk {
  chunkId: number;
  text: string;
  score?: number;
}

/** One row of the search-dialog result table. */
export interface DialogResult {
  itemKey: string;
  parentKey?: string;
  title?: string;
  creators?: string;
  year?: number | null;
  itemType?: string;
  score: number;
  matchedChunks?: DialogChunk[];
  /** Which of the search modes produced this row: semantic, keyword or both. */
  sources?: string[];
}

export const SOURCE_SEMANTIC = "semantic";
export const SOURCE_KEYWORD = "keyword";
export const SOURCE_BOTH = "both";

/** A single term highlighted inside a snippet, split by mark boundaries. */
export interface HighlightSegment {
  text: string;
  marked: boolean;
}

/** Column keys the result table can be sorted by. */
export type SortColumn = "similarity" | "title" | "authors" | "year";

/**
 * Clamp a score into the 0..1 range.
 *
 * Hybrid rows combine a semantic score with a keyword hit, and the old
 * `Math.max(score, 0.6) + 0.1` merge could push the value above 1, which the
 * table then rendered as "142%".
 */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.min(1, Math.max(0, score));
}

/** Render a score as a percentage, e.g. `0.42` -> `"42%"`. */
export function formatScore(score: number): string {
  return Math.round(clampScore(score) * 100) + "%";
}

/**
 * Merge the semantic and the keyword result list for one query.
 *
 * Items found by both modes keep their chunks, are flagged as `both`, and get
 * a slightly higher score. Duplicates inside either list are collapsed.
 */
export function mergeResults(
  semantic: readonly DialogResult[],
  keyword: readonly DialogResult[],
): DialogResult[] {
  const byKey = new Map<string, DialogResult>();

  for (const result of semantic) {
    if (!result || !result.itemKey) continue;
    byKey.set(result.itemKey, {
      ...result,
      sources: [SOURCE_SEMANTIC],
    });
  }

  for (const result of keyword) {
    if (!result || !result.itemKey) continue;
    const existing = byKey.get(result.itemKey);
    if (existing) {
      existing.sources = [...(existing.sources || []), SOURCE_KEYWORD];
      existing.matchedChunks = [
        ...(existing.matchedChunks || []),
        ...(result.matchedChunks || []),
      ];
      existing.score = clampScore(Math.max(existing.score, 0.6) + 0.1);
    } else {
      byKey.set(result.itemKey, { ...result, sources: [SOURCE_KEYWORD] });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => b.score - a.score);
}

/**
 * AND-combine several per-query result lists.
 *
 * @param sets result lists, one per query
 * @param formula how the per-query scores are combined: `min`, `product` or
 *   `average`
 */
export function intersectResults(
  sets: readonly DialogResult[][],
  formula: "min" | "product" | "average",
): DialogResult[] {
  if (sets.length === 0) {
    return [];
  }
  const keySets = sets.map((results) => new Set(results.map((r) => r.itemKey)));
  const shared = new Set(
    [...keySets[0]].filter((key) => keySets.every((s) => s.has(key))),
  );

  const result: DialogResult[] = [];
  for (const row of sets[0]) {
    if (!shared.has(row.itemKey)) continue;

    const scores = sets.map((results) => {
      const found = results.find((r) => r.itemKey === row.itemKey);
      return found ? found.score : 0;
    });
    let combined: number;
    if (formula === "min") {
      combined = Math.min(...scores);
    } else if (formula === "product") {
      combined = scores.reduce((a, b) => a * b, 1);
    } else {
      combined = scores.reduce((a, b) => a + b, 0) / scores.length;
    }

    const chunks: DialogChunk[] = [];
    for (const results of sets) {
      const found = results.find((r) => r.itemKey === row.itemKey);
      if (found?.matchedChunks) chunks.push(...found.matchedChunks);
    }
    result.push({
      ...row,
      score: clampScore(combined),
      sources: [SOURCE_BOTH],
      matchedChunks: chunks,
    });
  }

  return result.sort((a, b) => b.score - a.score);
}

/** OR-combine several per-query result lists, collapsing duplicates. */
export function unionResults(sets: readonly DialogResult[][]): DialogResult[] {
  const byKey = new Map<string, DialogResult>();
  for (const results of sets) {
    for (const row of results) {
      if (!row || !row.itemKey) continue;
      const existing = byKey.get(row.itemKey);
      if (existing) {
        existing.matchedChunks = [
          ...(existing.matchedChunks || []),
          ...(row.matchedChunks || []),
        ];
      } else {
        byKey.set(row.itemKey, { ...row });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.score - a.score);
}

/**
 * Sort result rows by a table column.
 *
 * @param direction `1` for ascending, `-1` for descending
 */
export function sortResults(
  results: readonly DialogResult[],
  column: SortColumn,
  direction: number,
): DialogResult[] {
  return [...results].sort((a, b) => {
    let valueA: string | number;
    let valueB: string | number;
    if (column === "similarity") {
      valueA = clampScore(a.score);
      valueB = clampScore(b.score);
    } else if (column === "title") {
      valueA = (a.title || "").toLowerCase();
      valueB = (b.title || "").toLowerCase();
    } else if (column === "authors") {
      valueA = (a.creators || "").toLowerCase();
      valueB = (b.creators || "").toLowerCase();
    } else {
      valueA = a.year || 0;
      valueB = b.year || 0;
    }
    if (typeof valueA === "string") {
      if (typeof valueB !== "string") return 0;
      return direction === 1
        ? valueA.localeCompare(valueB)
        : valueB.localeCompare(valueA);
    }
    if (typeof valueB === "string") return 0;
    return direction === 1 ? valueA - valueB : valueB - valueA;
  });
}

/**
 * Conditions handed to `Zotero.Search` for a literal keyword search.
 *
 * Every condition is ORed by the search, so a single irrelevant one makes the
 * whole search match every row — that is why the previous `itemType isNot
 * attachment` condition had to be dropped. Matching the abstract is a real
 * condition here instead of a manual scan over every item, which is both
 * cheaper and correct.
 */
export interface KeywordCondition {
  field: string;
  operator: string;
  value: string;
}

/** Build the ORed literal-match conditions for one keyword query. */
export function buildKeywordConditions(query: string): KeywordCondition[] {
  const value = query.trim();
  return [
    { field: "title", operator: "contains", value },
    { field: "creator", operator: "contains", value },
    { field: "tag", operator: "contains", value },
    { field: "abstractNote", operator: "contains", value },
  ];
}

/** A minimal `Zotero.Search` surface, so the wiring stays testable. */
export interface SearchBuilder {
  addCondition(field: string, operator: string, value: string): void;
}

/**
 * Configure a `Zotero.Search` for a literal keyword query.
 *
 * The library scope is intentionally left to the caller, which passes
 * `Zotero.Libraries.userLibraryID`.
 */
export function configureKeywordSearch(
  search: SearchBuilder,
  query: string,
): void {
  for (const condition of buildKeywordConditions(query)) {
    search.addCondition(condition.field, condition.operator, condition.value);
  }
}

/** Name for a collection saved from the current result set. */
export function buildCollectionName(
  collectionLabel: string,
  queries: readonly string[],
  maxLength = 100,
): string {
  return (collectionLabel + ": " + queries.join(" / ")).substring(0, maxLength);
}

/**
 * Trim a long chunk to a readable window. If any highlight term occurs in the
 * text, center the window on its first occurrence.
 */
export function windowSnippet(
  text: string,
  maxLength: number,
  terms: readonly string[],
): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }

  let start = 0;
  if (terms.length > 0) {
    const lower = clean.toLowerCase();
    let firstHit = -1;
    for (const term of terms) {
      const index = lower.indexOf(term.toLowerCase());
      if (index !== -1 && (firstHit === -1 || index < firstHit)) {
        firstHit = index;
      }
    }
    if (firstHit > maxLength / 2) {
      start = firstHit - Math.floor(maxLength / 2);
    }
  }

  const end = start + maxLength;
  const slice = clean.slice(start, end);
  if (start > 0) {
    return "\u2026" + slice;
  }
  if (end < clean.length) {
    return slice + "\u2026";
  }
  return slice;
}

/** Characters that form a word for the highlighting boundary check. */
const LATIN_WORD = /[a-z0-9]/i;
/** Terms made of CJK/kangu characters do not need word boundaries. */
const CJK_TERM = /^[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+$/;

/**
 * Split a snippet into runs of plain and marked text.
 *
 * The dialog used to escape the chunk and then run a regex over the escaped
 * text, so a query term like `amp` matched the `&amp;` entity and the inserted
 * `<mark>` broke the XML. Returning segments keeps the chunk as data and lets
 * the caller build `<mark>` elements with `textContent`, which is safe for any
 * query text.
 */
export function highlightSegments(
  text: string,
  terms: readonly string[],
): HighlightSegment[] {
  const source = text || "";
  const cleaned = cleanTerms(terms);
  if (cleaned.length === 0) {
    return [{ text: source, marked: false }];
  }

  const lower = source.toLowerCase();
  const marks: Array<[number, number]> = [];
  for (const term of cleaned) {
    let from = 0;
    let index = lower.indexOf(term, from);
    while (index !== -1) {
      if (isWordBoundary(source, index, index + term.length, term)) {
        marks.push([index, index + term.length]);
      }
      from = index + 1;
      index = lower.indexOf(term, from);
    }
  }
  if (marks.length === 0) {
    return [{ text: source, marked: false }];
  }

  marks.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [marks[0]];
  for (const mark of marks.slice(1)) {
    const last = merged[merged.length - 1];
    if (mark[0] <= last[1]) {
      last[1] = Math.max(last[1], mark[1]);
    } else {
      merged.push([mark[0], mark[1]]);
    }
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: source.slice(cursor, start), marked: false });
    }
    segments.push({ text: source.slice(start, end), marked: true });
    cursor = end;
  }
  if (cursor < source.length) {
    segments.push({ text: source.slice(cursor), marked: false });
  }
  return segments;
}

/** Lowercase, deduplicated terms, longest first so compounds win. */
function cleanTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const term of terms) {
    if (!term) continue;
    const word = term
      .toLowerCase()
      .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+/g, " ")
      .trim();
    if (word.length < 2 || seen.has(word)) continue;
    seen.add(word);
    cleaned.push(word);
  }
  return cleaned.sort((a, b) => b.length - a.length);
}

/** CJK terms match anywhere; latin terms only on word boundaries. */
function isWordBoundary(
  text: string,
  start: number,
  end: number,
  term: string,
): boolean {
  if (CJK_TERM.test(term)) {
    return true;
  }
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  return !LATIN_WORD.test(before) && !LATIN_WORD.test(after);
}

/**
 * Monotonic request tokens, so a slow earlier search cannot overwrite the
 * results of a newer one.
 */
export interface SearchSequencer {
  /** Take the next token. */
  next(): number;
  /** True when `token` is still the most recent request. */
  isCurrent(token: number): boolean;
}

export function createSearchSequencer(): SearchSequencer {
  let current = 0;
  return {
    next() {
      return ++current;
    },
    isCurrent(token: number) {
      return token === current;
    },
  };
}
