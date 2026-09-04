/**
 * Citation & bibliography export service.
 *
 * - BibTeX/BibLaTeX/CSL exports are provided by Better BibTeX (BBT) JSON-RPC.
 * - Formatted references and in-text citations use Zotero's native Quick Copy API.
 */

import { assertSafeCitationFilePath } from "./citationFileSafety";

declare let ztoolkit: ZToolkit;
declare const IOUtils: any;

const BBT_TRANSLATORS: Record<string, string> = {
  biblatex: "Better BibLaTeX",
  bibtex: "Better BibTeX",
  csljson: "Better CSL JSON",
  cslyaml: "Better CSL YAML",
};

const BBT_DEFAULT_PORT = 23119;
const APA_STYLE_ID = "http://www.zotero.org/styles/apa";

type CitationMode = "bibliography" | "citation";
type CitationContentType = "html" | "text";

interface StyleInfo {
  id?: string;
  title?: string;
  isDefault: boolean;
  hasBibliography?: boolean;
}

export class CitationExportService {
  private get bbtRpcUrl(): string {
    return `http://localhost:${BBT_DEFAULT_PORT}/better-bibtex/json-rpc`;
  }

  private async bbtRpc(method: string, params: any[] = []): Promise<any> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: `zotero-mcp-${Date.now()}`,
    });

    let response: any;
    try {
      response = await Zotero.HTTP.request("POST", this.bbtRpcUrl, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Zotero-Allowed-Request": "1",
        },
        body,
        timeout: 30000,
        responseType: "json",
      });
    } catch (error) {
      throw new Error(
        `Could not connect to Better BibTeX JSON-RPC at ${this.bbtRpcUrl}. ` +
          `Make sure Better BibTeX is installed and enabled. ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }

    if (response.status >= 400) {
      throw new Error(
        `Better BibTeX JSON-RPC returned HTTP ${response.status}`,
      );
    }

    const data = response.response ?? JSON.parse(response.responseText ?? "{}");
    if (data.error) {
      throw new Error(
        `Better BibTeX JSON-RPC error: ${
          data.error.message ?? JSON.stringify(data.error)
        }`,
      );
    }

    return data.result;
  }

  private async resolveCitekeys(
    itemKeys: string[],
    libraryID?: number,
  ): Promise<{
    citekeys: string[];
    map: Record<string, string>;
    missing: string[];
  }> {
    const lookupKeys = itemKeys.map((itemKey) =>
      libraryID === undefined || libraryID === null
        ? itemKey
        : `${libraryID}:${itemKey}`,
    );

    const result = (await this.bbtRpc("item.citationkey", [lookupKeys])) ?? {};
    const map: Record<string, string> = {};
    const citekeys: string[] = [];
    const missing: string[] = [];

    itemKeys.forEach((itemKey, index) => {
      const citekey = result[lookupKeys[index]] ?? result[itemKey];
      if (citekey) {
        map[itemKey] = String(citekey);
        citekeys.push(String(citekey));
      } else {
        missing.push(itemKey);
      }
    });

    return { citekeys, map, missing };
  }

  async exportBibliography(params: {
    itemKeys: string[];
    format?: "biblatex" | "bibtex" | "csljson" | "cslyaml";
    libraryID?: number;
  }): Promise<any> {
    const { itemKeys, format = "biblatex", libraryID } = params;

    if (!Array.isArray(itemKeys) || itemKeys.length === 0) {
      throw new Error("itemKeys must contain at least one Zotero item key");
    }

    const translator = BBT_TRANSLATORS[format];
    if (!translator) {
      throw new Error(
        `Unsupported export format "${format}". ` +
          "Use biblatex, bibtex, csljson, or cslyaml.",
      );
    }

    const { citekeys, map, missing } = await this.resolveCitekeys(
      itemKeys,
      libraryID,
    );
    if (citekeys.length === 0) {
      throw new Error(
        `Better BibTeX could not resolve citation keys for: ${missing.join(", ")}`,
      );
    }

    const rpcParams: any[] = [citekeys, translator];
    if (libraryID !== undefined && libraryID !== null) {
      rpcParams.push(libraryID);
    }

    const content = await this.bbtRpc("item.export", rpcParams);

    ztoolkit.log(
      `[CitationExport] exportBibliography: format=${format}, exported=${citekeys.length}, missing=${missing.length}`,
    );

    return {
      format,
      content: String(content ?? ""),
      exportedCount: citekeys.length,
      citationKeys: citekeys,
      itemKeyToCitationKey: map,
      ...(missing.length > 0 ? { missingKeys: missing } : {}),
    };
  }

  private resolveStyle(style: string): {
    styleID: string;
    title: string;
    hasBibliography: boolean;
  } | null {
    const candidates = [style];
    if (!style.includes("://")) {
      candidates.push(`http://www.zotero.org/styles/${style}`);
    }

    for (const candidate of candidates) {
      try {
        const resolved = Zotero.Styles.get(candidate);
        if (resolved) {
          return {
            styleID: resolved.styleID,
            title: resolved.title,
            hasBibliography: resolved.hasBibliography,
          };
        }
      } catch {
        // Continue with title matching below.
      }
    }

    const normalized = style.toLowerCase();
    const styles = Zotero.Styles.getVisible();
    const exact = styles.find(
      (candidate: any) => candidate.title.toLowerCase() === normalized,
    );
    const partial =
      exact ??
      styles.find((candidate: any) =>
        candidate.title.toLowerCase().includes(normalized),
      );

    if (!partial) return null;

    return {
      styleID: partial.styleID,
      title: partial.title,
      hasBibliography: partial.hasBibliography,
    };
  }

  private getDefaultQuickCopyFormat(contentType: CitationContentType): {
    format: any;
    styleInfo: StyleInfo;
  } {
    const rawSetting = Zotero.Prefs.get("export.quickCopy.setting") as any;
    const parsed = (Zotero.QuickCopy as any).unserializeSetting(rawSetting);

    if (parsed?.mode === "bibliography" && parsed?.id) {
      let title: string | undefined;
      let hasBibliography: boolean | undefined;
      try {
        const style = Zotero.Styles.get(parsed.id);
        title = style?.title;
        hasBibliography = style?.hasBibliography;
      } catch {
        // A stale Quick Copy style will fail naturally when Quick Copy runs.
      }

      return {
        format: {
          ...parsed,
          mode: "bibliography",
          contentType,
        },
        styleInfo: {
          id: parsed.id,
          title,
          isDefault: true,
          hasBibliography,
        },
      };
    }

    return {
      format: {
        mode: "bibliography",
        id: APA_STYLE_ID,
        contentType,
        locale: "",
      },
      styleInfo: {
        id: APA_STYLE_ID,
        title: "APA (fallback)",
        isDefault: true,
      },
    };
  }

  async getCitation(params: {
    itemKeys: string[];
    style?: string;
    contentType?: CitationContentType;
    mode?: CitationMode;
    libraryID?: number;
  }): Promise<any> {
    const {
      itemKeys,
      style,
      contentType = "html",
      mode = "bibliography",
      libraryID,
    } = params;

    if (!Array.isArray(itemKeys) || itemKeys.length === 0) {
      throw new Error("itemKeys must contain at least one Zotero item key");
    }

    const resolvedLibraryID =
      libraryID !== undefined && libraryID !== null
        ? libraryID
        : Zotero.Libraries.userLibraryID;

    const items: Zotero.Item[] = [];
    const missing: string[] = [];
    const skipped: string[] = [];

    for (const itemKey of itemKeys) {
      const item = await Zotero.Items.getByLibraryAndKeyAsync(
        resolvedLibraryID,
        itemKey,
      );
      if (!item) {
        missing.push(itemKey);
      } else if (item.isAttachment() || item.isNote()) {
        skipped.push(itemKey);
      } else {
        items.push(item);
      }
    }

    if (items.length === 0) {
      throw new Error(
        "No citable Zotero items were found for the supplied itemKeys",
      );
    }

    let format: any;
    let styleInfo: StyleInfo;

    if (style) {
      const resolved = this.resolveStyle(style);
      if (!resolved) {
        throw new Error(
          `Citation style "${style}" was not found. ` +
            "Use list_citation_styles to inspect available styles.",
        );
      }

      format = {
        mode: "bibliography",
        id: resolved.styleID,
        contentType,
        locale: "",
      };
      styleInfo = {
        id: resolved.styleID,
        title: resolved.title,
        isDefault: false,
        hasBibliography: resolved.hasBibliography,
      };
    } else {
      ({ format, styleInfo } = this.getDefaultQuickCopyFormat(contentType));
    }

    const asCitations = mode === "citation";
    let result: any;
    try {
      result = (Zotero.QuickCopy as any).getContentFromItems(
        items,
        format,
        undefined,
        asCitations,
      );
    } catch (error) {
      throw new Error(
        `Failed to generate ${mode}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!result || typeof result !== "object") {
      throw new Error(
        "Zotero Quick Copy did not return citation content. " +
          "The selection may exceed the configured Quick Copy item limit.",
      );
    }

    ztoolkit.log(
      `[CitationExport] getCitation: mode=${mode}, style=${styleInfo.id ?? "default"}, items=${items.length}, missing=${missing.length}, skipped=${skipped.length}`,
    );

    return {
      mode,
      style: styleInfo.id,
      styleTitle: styleInfo.title,
      isDefaultStyle: styleInfo.isDefault,
      content:
        contentType === "html" ? (result.html ?? result.text) : result.text,
      itemCount: items.length,
      ...(missing.length > 0 ? { missingKeys: missing } : {}),
      ...(skipped.length > 0 ? { skippedKeys: skipped } : {}),
    };
  }

  async listStyles(filter?: string): Promise<any> {
    try {
      await (Zotero.Schema as any).schemaUpdatePromise;
    } catch {
      // Style discovery can still work if the schema promise is unavailable.
    }

    const normalizedFilter = filter?.trim().toLowerCase();
    const styles = Zotero.Styles.getVisible()
      .map((style: any) => ({ id: style.styleID, title: style.title }))
      .filter(
        (style: { id: string; title: string }) =>
          !normalizedFilter ||
          style.id.toLowerCase().includes(normalizedFilter) ||
          style.title.toLowerCase().includes(normalizedFilter),
      )
      .sort((a: { title: string }, b: { title: string }) =>
        a.title.localeCompare(b.title),
      );

    return {
      total: styles.length,
      styles,
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private countBibtexEntries(value: string): number {
    return value.match(/@\w+\s*\{\s*[^,\s]+/g)?.length ?? 0;
  }

  private async getAllItemKeys(
    libraryID: number,
    includeChildren = false,
  ): Promise<string[]> {
    const search = new Zotero.Search();
    (search as any).libraryID = libraryID;
    if (!includeChildren) {
      search.addCondition("noChildren", "true");
    }
    const ids = await search.search();
    const items = await Zotero.Items.getAsync(ids);
    return items
      .filter((item: Zotero.Item) => !item.isAttachment() && !item.isNote())
      .map((item: Zotero.Item) => item.key);
  }

  private async findItemByKeyOrQuery(
    itemKey: string | undefined,
    query: string | undefined,
    libraryID: number,
  ): Promise<Zotero.Item> {
    if (itemKey && query) {
      throw new Error("Provide either itemKey or query, not both");
    }
    if (itemKey) {
      const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, itemKey);
      if (!item || item.isAttachment() || item.isNote()) {
        throw new Error(`No citable item found with key: ${itemKey}`);
      }
      return item;
    }
    if (!query?.trim()) {
      throw new Error("Either itemKey or query must be provided");
    }

    const search = new Zotero.Search();
    (search as any).libraryID = libraryID;
    search.addCondition("noChildren", "true");
    const ids = await search.search();
    const items = await Zotero.Items.getAsync(ids);
    const normalized = query.trim().toLowerCase();
    const matches = items.filter((item: Zotero.Item) => {
      if (item.isAttachment() || item.isNote()) return false;
      const title = String(item.getField("title") || "").toLowerCase();
      const creators = item
        .getCreators()
        .map((creator: any) =>
          [creator.lastName, creator.firstName, creator.name]
            .filter(Boolean)
            .join(" "),
        )
        .join(" ")
        .toLowerCase();
      return title.includes(normalized) || creators.includes(normalized);
    });

    if (matches.length === 0) {
      throw new Error(`No items found matching query: "${query}"`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Query "${query}" matched ${matches.length} items. Use itemKey for an unambiguous citation.`,
      );
    }
    return matches[0];
  }

  async syncBibFile(params: {
    bibPath: string;
    format?: "bibtex" | "biblatex";
    libraryID?: number;
    includeChildren?: boolean;
    overwrite?: boolean;
    batchSize?: number;
  }): Promise<any> {
    const {
      format = "bibtex",
      libraryID,
      includeChildren = false,
      overwrite = false,
      batchSize = 100,
    } = params;
    const bibPath = assertSafeCitationFilePath(
      params.bibPath,
      [".bib"],
      "bibPath",
    );
    if (format !== "bibtex" && format !== "biblatex") {
      throw new Error("sync_bib supports only bibtex or biblatex output");
    }
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new Error("batchSize must be an integer between 1 and 500");
    }
    if ((await IOUtils.exists(bibPath)) && !overwrite) {
      throw new Error(
        `Refusing to overwrite existing bibliography: ${bibPath}. Set overwrite=true to replace it.`,
      );
    }

    const resolvedLibraryID =
      libraryID ?? Zotero.Libraries.userLibraryID;
    const itemKeys = await this.getAllItemKeys(
      resolvedLibraryID,
      includeChildren,
    );
    if (itemKeys.length === 0) {
      throw new Error("No citable items found in the library");
    }

    const chunks: string[] = [];
    const missingKeys: string[] = [];
    let exportedCount = 0;
    for (let offset = 0; offset < itemKeys.length; offset += batchSize) {
      const batch = itemKeys.slice(offset, offset + batchSize);
      const exported = await this.exportBibliography({
        itemKeys: batch,
        format,
        libraryID: resolvedLibraryID,
      });
      const content = String(exported.content ?? "").trim();
      if (content) chunks.push(content);
      exportedCount += Number(exported.exportedCount ?? 0);
      if (Array.isArray(exported.missingKeys)) {
        missingKeys.push(...exported.missingKeys);
      }
    }

    const content = `${chunks.join("\n\n")}\n`;
    await IOUtils.writeUTF8(bibPath, content);

    ztoolkit.log(
      `[CitationExport] syncBibFile: format=${format}, items=${itemKeys.length}, exported=${exportedCount}, batches=${Math.ceil(itemKeys.length / batchSize)}, path=${bibPath}`,
    );
    return {
      path: bibPath,
      format,
      entries: this.countBibtexEntries(content),
      exportedCount,
      batchSize,
      batches: Math.ceil(itemKeys.length / batchSize),
      ...(missingKeys.length ? { missingKeys } : {}),
    };
  }

  async citeInDraft(params: {
    itemKey?: string;
    query?: string;
    bibPath: string;
    texPath?: string;
    markdownPath?: string;
    marker?: string;
    append?: boolean;
    libraryID?: number;
  }): Promise<any> {
    const bibPath = assertSafeCitationFilePath(
      params.bibPath,
      [".bib"],
      "bibPath",
    );
    const hasTex = typeof params.texPath === "string" && !!params.texPath.trim();
    const hasMarkdown =
      typeof params.markdownPath === "string" && !!params.markdownPath.trim();
    if (hasTex === hasMarkdown) {
      throw new Error("Provide exactly one of texPath or markdownPath");
    }
    const draftPath = hasTex
      ? assertSafeCitationFilePath(params.texPath, [".tex"], "texPath")
      : assertSafeCitationFilePath(
          params.markdownPath,
          [".md", ".markdown"],
          "markdownPath",
        );
    if (!(await IOUtils.exists(draftPath))) {
      throw new Error(`Draft file does not exist: ${draftPath}`);
    }
    if (!params.marker && params.append !== true) {
      throw new Error(
        "Provide marker to replace, or set append=true to explicitly append a citation",
      );
    }

    const resolvedLibraryID =
      params.libraryID ?? Zotero.Libraries.userLibraryID;
    const item = await this.findItemByKeyOrQuery(
      params.itemKey,
      params.query,
      resolvedLibraryID,
    );
    const exported = await this.exportBibliography({
      itemKeys: [item.key],
      format: "bibtex",
      libraryID: resolvedLibraryID,
    });
    const citekey = exported.citationKeys?.[0];
    if (!citekey) {
      throw new Error("Better BibTeX did not return a citation key");
    }
    const bibtex = String(exported.content ?? "").trim();

    let existingBib = "";
    if (await IOUtils.exists(bibPath)) {
      existingBib = await IOUtils.readUTF8(bibPath);
    }
    const keyRegex = new RegExp(
      `@\\w+\\s*\\{\\s*${this.escapeRegex(citekey)}\\s*,`,
      "i",
    );
    const bibEntryAdded = !keyRegex.test(existingBib);
    const nextBib = bibEntryAdded
      ? `${existingBib.replace(/\s*$/, "")}${existingBib.trim() ? "\n\n" : ""}${bibtex}\n`
      : existingBib;

    const citation = hasTex ? `\\cite{${citekey}}` : `[@${citekey}]`;
    const draft = await IOUtils.readUTF8(draftPath);
    let nextDraft: string;
    if (params.marker) {
      if (!draft.includes(params.marker)) {
        throw new Error(`Marker "${params.marker}" not found in ${draftPath}`);
      }
      nextDraft = draft.replace(params.marker, citation);
    } else {
      nextDraft = `${draft}${draft && !draft.endsWith("\n") ? "\n" : ""}${citation}\n`;
    }

    if (bibEntryAdded) {
      await IOUtils.writeUTF8(bibPath, nextBib);
    }
    await IOUtils.writeUTF8(draftPath, nextDraft);

    ztoolkit.log(
      `[CitationExport] citeInDraft: itemKey=${item.key}, citekey=${citekey}, bibAdded=${bibEntryAdded}, draft=${draftPath}`,
    );
    return {
      itemKey: item.key,
      title: String(item.getField("title") || ""),
      citationKey: citekey,
      bibPath,
      bibEntryAdded,
      editedFile: draftPath,
      inserted: citation,
    };
  }

}
