/**
 * Citation & Bibliography Export Service
 *
 * 提供两个核心能力：
 *  1. 基于 zotero-better-bibtex (BBT) 的 BibLaTeX/BibTeX 条目导出
 *     —— 通过 BBT 内嵌 webserver 的 JSON-RPC API (http://localhost:23119/better-bibtex/json-rpc)
 *  2. 指定 CSL 样式的参考文献条目生成（未指定样式时回退到 Zotero 默认 Quick Copy 样式）
 *     —— 通过 Zotero 原生 Zotero.QuickCopy API
 *
 * BBT JSON-RPC 关键方法（参见 https://retorque.re/zotero-better-bibtex/exporting/json-rpc/）：
 *   - api.ready()                       检测 BBT 是否可用
 *   - item.citationkey(item_keys)       由 itemKey 解析 citation key
 *   - item.export(citekeys, translator) 按 BBT 翻译器导出条目字符串
 *   - item.bibliography(citekeys, fmt)  按 CSL 样式生成参考文献
 *
 * Zotero 原生引文 API（参见 https://www.zotero.org/support/dev/client_coding/javascript_api）：
 *   - Zotero.QuickCopy.getContentFromItems(items, format, library, asCitations)
 *   - Zotero.Styles.getVisible() / Zotero.Styles.get(styleID)
 */

import { assertSafeCitationFilePath } from "./citationFileSafety";

declare let ztoolkit: ZToolkit;
declare const IOUtils: any;

/** BBT 导出格式 -> 翻译器名称映射 */
const BBT_TRANSLATORS: Record<string, string> = {
  biblatex: "Better BibLaTeX",
  bibtex: "Better BibTeX",
  csljson: "Better CSL JSON",
  json: "Better CSL JSON",
  cslyaml: "Better CSL YAML",
  yaml: "Better CSL YAML",
  yml: "Better CSL YAML",
};

/** BBT 默认端口（Juris-M 为 24119） */
const BBT_DEFAULT_PORT = 23119;

/** 未知 BBT 版本时的占位符 */
const UNKNOWN = "unknown";
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
  /** BBT JSON-RPC 基地址 */
  private get bbtRpcUrl(): string {
    return `http://localhost:${BBT_DEFAULT_PORT}/better-bibtex/json-rpc`;
  }

  /**
   * 调用 BBT JSON-RPC 方法。
   * @param method JSON-RPC 方法名
   * @param params 位置参数数组
   * @returns result 字段
   */
  private async bbtRpc(method: string, params: any[] = []): Promise<any> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: `mcp-${Date.now()}`,
    });

    let response: any;
    try {
      response = await Zotero.HTTP.request("POST", this.bbtRpcUrl, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // Zotero blocks browser-like requests to its embedded webserver.
          // This header signals a programmatic request and is the officially
          // recommended workaround (see BBT issue #3554).
          "Zotero-Allowed-Request": "1",
        },
        body,
        timeout: 30000,
        responseType: "json",
      });
    } catch (e) {
      throw new Error(
        `无法连接 Better BibTeX JSON-RPC 服务 (${this.bbtRpcUrl})。请确认已安装并启用 zotero-better-bibtex 插件，且 Zotero 正在运行。原始错误: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (response.status >= 400) {
      throw new Error(`Better BibTeX JSON-RPC 返回 HTTP ${response.status}`);
    }

    const data: any =
      response.response ?? JSON.parse(response.responseText ?? "{}");
    if (data.error) {
      throw new Error(
        `Better BibTeX JSON-RPC 错误: ${data.error.message ?? JSON.stringify(data.error)}`,
      );
    }
    return data.result;
  }

  /**
   * 检测 Better BibTeX 是否安装且 JSON-RPC 可用。
   */
  async checkBBT(): Promise<{
    available: boolean;
    betterbibtexVersion?: string;
    zoteroVersion?: string;
    error?: string;
  }> {
    try {
      const result = await this.bbtRpc("api.ready", []);
      return {
        available: true,
        betterbibtexVersion: result?.betterbibtex ?? UNKNOWN,
        zoteroVersion: result?.zotero ?? UNKNOWN,
      };
    } catch (e) {
      return {
        available: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * 将 Zotero itemKey 解析为 BBT citation key。
   * @param itemKeys 条目 key 数组（如 ["ABCD1234"]）
   * @param libraryID 可选库 ID；省略时表示用户个人库
   */
  async resolveCitekeys(
    itemKeys: string[],
    libraryID?: number,
  ): Promise<{
    citekeys: string[];
    map: Record<string, string>;
    missing: string[];
  }> {
    // BBT 的 item.citationkey 接受 [libraryID]:[itemKey] 形式的字符串
    const keyStrings = itemKeys.map((k) =>
      libraryID !== undefined && libraryID !== null ? `${libraryID}:${k}` : k,
    );

    const result = (await this.bbtRpc("item.citationkey", [keyStrings])) ?? {};

    const map: Record<string, string> = {};
    const citekeys: string[] = [];
    const missing: string[] = [];

    for (let i = 0; i < itemKeys.length; i++) {
      const itemKey = itemKeys[i];
      const lookupKey = keyStrings[i];
      const citekey = result[lookupKey] ?? result[itemKey];
      if (citekey) {
        map[itemKey] = citekey;
        citekeys.push(citekey);
      } else {
        missing.push(itemKey);
      }
    }

    return { citekeys, map, missing };
  }

  /**
   * 【功能 1】通过 Better BibTeX 导出参考文献条目（BibLaTeX / BibTeX / CSL-JSON / CSL-YAML）。
   *
   * @param params.itemKeys 要导出的条目 key 数组
   * @param params.format   导出格式：biblatex(默认) | bibtex | csljson | cslyaml
   * @param params.libraryID 可选库 ID
   * @param params.exportNotes 是否导出笔记（BBT displayOptions）
   * @param params.useJournalAbbreviation 是否使用期刊缩写（BBT displayOptions）
   */
  async exportBibliography(params: {
    itemKeys: string[];
    format?: string;
    libraryID?: number;
    exportNotes?: boolean;
    useJournalAbbreviation?: boolean;
  }): Promise<any> {
    const {
      itemKeys,
      format = "biblatex",
      libraryID,
      exportNotes = false,
      useJournalAbbreviation = false,
    } = params;

    if (!itemKeys || itemKeys.length === 0) {
      throw new Error("itemKeys 不能为空");
    }

    const normalizedFormat = (format || "biblatex").toLowerCase();
    const translator =
      BBT_TRANSLATORS[normalizedFormat] ?? BBT_TRANSLATORS.biblatex;

    // 1) 先校验 BBT 可用性，给出友好错误
    const bbtStatus = await this.checkBBT();
    if (!bbtStatus.available) {
      throw new Error(
        `导出 ${normalizedFormat} 需要 Better BibTeX 插件支持，但当前不可用：${bbtStatus.error ?? "未知原因"}`,
      );
    }

    // 2) 解析 citation key
    const { citekeys, missing } = await this.resolveCitekeys(
      itemKeys,
      libraryID,
    );
    if (citekeys.length === 0) {
      throw new Error(
        `未能为给定条目解析出任何 citation key。请确认条目存在且 Better BibTeX 已为其生成引用键。缺失: ${missing.join(", ")}`,
      );
    }

    // 3) 调用 item.export 导出
    //    item.export(citekeys, translator, libraryID?)
    const rpcParams: any[] = [citekeys, translator];
    if (libraryID !== undefined && libraryID !== null) {
      rpcParams.push(libraryID);
    }

    let exportString: string;
    try {
      exportString = await this.bbtRpc("item.export", rpcParams);
    } catch (e) {
      // BBT item.export 可能不支持 displayOptions，作为独立提示
      throw new Error(
        `调用 BBT item.export 失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    ztoolkit.log(
      `[CitationExport] exportBibliography: format=${normalizedFormat}, translator=${translator}, exported=${citekeys.length}, missing=${missing.length}`,
    );

    return {
      format: normalizedFormat,
      content: exportString,
      exportedCount: citekeys.length,
      citationKeys: citekeys,
      missingKeys: missing.length > 0 ? missing : undefined,
    };
  }

  /**
   * 解析 CSL 样式：先按 styleID 精确匹配，再按标题精确/模糊匹配。
   * @returns 命中的样式对象，或 null
   */
  private resolveStyle(style: string): {
    styleID: string;
    title: string;
    hasBibliography: boolean;
  } | null {
    // 1) 按 styleID 精确匹配
    try {
      const s = Zotero.Styles.get(style);
      if (s) {
        return {
          styleID: s.styleID,
          title: s.title,
          hasBibliography: s.hasBibliography,
        };
      }
    } catch {
      // 忽略，继续按标题匹配
    }

    // 2) 按标题精确匹配（大小写不敏感）
    const styles = Zotero.Styles.getVisible();
    const lower = style.toLowerCase();
    for (const s of styles) {
      if (s.title.toLowerCase() === lower) {
        return {
          styleID: s.styleID,
          title: s.title,
          hasBibliography: s.hasBibliography,
        };
      }
    }

    // 3) 按标题模糊匹配
    for (const s of styles) {
      if (s.title.toLowerCase().includes(lower)) {
        return {
          styleID: s.styleID,
          title: s.title,
          hasBibliography: s.hasBibliography,
        };
      }
    }
    return null;
  }

  /**
   * 【功能 2】生成指定 CSL 样式的参考文献条目。
   * 若未指定 style，则使用 Zotero 默认 Quick Copy 样式。
   *
   * @param params.itemKeys    条目 key 数组
   * @param params.style       可选 CSL 样式 ID 或标题（如 "apa"、"http://www.zotero.org/styles/apa"）
   * @param params.contentType 输出格式：html(默认) | text
   * @param params.mode        生成模式：bibliography(默认，参考文献条目) | citation(文内引用)
   * @param params.libraryID   可选库 ID
   */
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
      style: styleInfo.id ?? undefined,
      styleTitle: styleInfo.title ?? undefined,
      content:
        contentType === "html" ? (result.html ?? result.text) : result.text,
      itemCount: items.length,
      missingKeys: missing.length > 0 ? missing : undefined,
    };
  }

  /**
   * 列出 Zotero 中可用的 CSL 引文样式。
   * @param filter 可选关键字过滤（按标题或 ID）
   */
  async listStyles(filter?: string): Promise<any> {
    // 确保样式 schema 已加载
    try {
      await Zotero.Schema.schemeUpdatePromise;
    } catch {
      // 忽略 schema 加载错误
    }

    const styles = Zotero.Styles.getVisible();
    let mapped = styles.map((s: any) => ({
      id: s.styleID,
      title: s.title,
    }));

    if (filter) {
      const f = filter.toLowerCase();
      mapped = mapped.filter(
        (s: any) =>
          s.title.toLowerCase().includes(f) || s.id.toLowerCase().includes(f),
      );
    }

    return {
      total: mapped.length,
      styles: mapped,
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
    // Preserve cloneorcopy behavior: itemKey wins when both are supplied.
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
      ztoolkit.log(
        `[CitationExport] findItemByKeyOrQuery: ${matches.length} matches, using first: ${matches[0].key}`,
      );
    }
    return matches[0];
  }

  async syncBibFile(params: {
    bibPath: string;
    format?: "bibtex" | "biblatex" | "csljson" | "cslyaml";
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
    libraryID?: number;
  }): Promise<any> {
    const bibPath = assertSafeCitationFilePath(
      params.bibPath,
      [".bib"],
      "bibPath",
    );

    // Preserve cloneorcopy behavior: texPath wins if both are supplied, and a
    // missing draft is created. The safety boundary is the absolute-path and
    // extension validation plus the default-off tool gate.
    const hasTex = typeof params.texPath === "string" && !!params.texPath.trim();
    const hasMarkdown =
      typeof params.markdownPath === "string" && !!params.markdownPath.trim();
    if (!hasTex && !hasMarkdown) {
      throw new Error("Either texPath or markdownPath must be provided");
    }
    const draftPath = hasTex
      ? assertSafeCitationFilePath(params.texPath, [".tex"], "texPath")
      : assertSafeCitationFilePath(
          params.markdownPath,
          [".md", ".markdown"],
          "markdownPath",
        );

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
    if (bibEntryAdded) {
      const prefix =
        existingBib.trim().length > 0
          ? existingBib.replace(/\n+$/, "") + "\n\n"
          : "";
      await IOUtils.writeUTF8(bibPath, prefix + bibtex + "\n");
    }

    const citation = hasTex ? `\\cite{${citekey}}` : `[@${citekey}]`;
    let draft = "";
    if (await IOUtils.exists(draftPath)) {
      draft = await IOUtils.readUTF8(draftPath);
    }
    if (params.marker) {
      if (!draft.includes(params.marker)) {
        throw new Error(`Marker "${params.marker}" not found in ${draftPath}`);
      }
      draft = draft.replace(params.marker, citation);
    } else {
      const suffix = draft.length === 0 || draft.endsWith("\n") ? "" : "\n";
      draft = draft + suffix + citation + "\n";
    }
    await IOUtils.writeUTF8(draftPath, draft);

    ztoolkit.log(
      `[CitationExport] citeInDraft: itemKey=${item.key}, citekey=${citekey}, bibAdded=${bibEntryAdded}, draft=${draftPath}`,
    );
    return {
      item_key: item.key,
      title: String(item.getField("title") || ""),
      bibtex_key: citekey,
      bib_path: bibPath,
      bib_entry_added: bibEntryAdded,
      edited_file: draftPath,
      inserted: citation,
    };
  }

}
