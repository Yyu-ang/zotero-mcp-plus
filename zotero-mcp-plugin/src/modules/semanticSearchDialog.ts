/**
 * Semantic Search Dialog for Zotero MCP Plugin
 *
 * 参考 ZotSeek 的搜索对话框实现，在 Zotero 中创建一个独立的语义搜索窗口，
 * 复用 zotero-mcp 原有的向量缓存数据库（VectorStore + EmbeddingService）
 * 实现搜索，不添加或更改原始数据库。
 *
 * 窗口通过 openDialog 打开，UI 逻辑在 searchDialog.xhtml 中内联实现，
 * TypeScript 控制器负责注入搜索回调与纯函数结果工具。
 *
 * UI adapted from ZotSeek (https://github.com/introfini/ZotSeek),
 * Copyright (c) 2025 José Fernandes, MIT License.
 */

import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import {
  getSemanticSearchService,
  type SemanticSearchResult,
} from "./semantic";
import {
  buildCollectionName,
  configureKeywordSearch,
  createSearchSequencer,
  formatScore,
  highlightSegments,
  intersectResults,
  mergeResults,
  sortResults,
  unionResults,
  windowSnippet,
} from "./semantic/dialogResults";

declare let Zotero: any;
declare let ztoolkit: ZToolkit;
declare let Services: any;

/** 对话框 chrome URL */
const DIALOG_URL = `chrome://${config.addonRef}/content/searchDialog.xhtml`;
const DIALOG_NAME = "zotero-mcp-semantic-search-dialog";

/** 工具栏按钮 ID */
const TOOLBAR_BUTTON_ID = "zotero-mcp-semantic-search-button";
const TOOLBAR_SEPARATOR_ID = "zotero-mcp-semantic-search-separator";

/** 右键菜单 ID */
const CONTEXT_MENU_FIND_SIMILAR_ID = "zotero-mcp-find-similar";
const CONTEXT_MENU_SEPARATOR_ID = "zotero-mcp-find-similar-separator";

/** 语义搜索开关偏好 */
const PREF_SEMANTIC_ENABLED =
  "extensions.zotero.zotero-mcp-plugin.semantic.enabled";

/** 对话框等待初始化的最长时间 */
const DIALOG_INIT_TIMEOUT_MS = 8000;

/** 需要在卸载时清理的 DOM 元素 ID */
export const SEMANTIC_DIALOG_ELEMENT_IDS = [
  TOOLBAR_BUTTON_ID,
  TOOLBAR_SEPARATOR_ID,
  CONTEXT_MENU_FIND_SIMILAR_ID,
  CONTEXT_MENU_SEPARATOR_ID,
];

/**
 * 对话框窗口可用的纯函数结果工具。
 *
 * 这些函数不依赖 Zotero 与 DOM，因此 `test/dialogResults.test.ts` 可以直接
 * 覆盖；对话框通过 window 参数拿到同一份实现。
 */
const RESULT_UTILS = {
  mergeResults,
  intersectResults,
  unionResults,
  sortResults,
  formatScore,
  windowSnippet,
  highlightSegments,
  configureKeywordSearch,
  buildCollectionName,
  createSearchSequencer,
};

/** 菜单项可见性处理，按元素保存以便卸载时移除。 */
const itemMenuHandlers = new WeakMap<Element, EventListener>();

/** 语义搜索偏好观察者 ID */
let semanticPrefObserverID: unknown = null;

/**
 * 语义搜索是否开启。
 *
 * 未设置时默认开启，与 MCP 工具侧的判定保持一致。
 */
export function isSemanticSearchEnabled(): boolean {
  try {
    return Zotero.Prefs.get(PREF_SEMANTIC_ENABLED, true) !== false;
  } catch (error) {
    ztoolkit.log(
      `[SemanticDialog] Could not read ${PREF_SEMANTIC_ENABLED}: ${error instanceof Error ? error.message : String(error)}`,
      "warn",
    );
    return true;
  }
}

/**
 * 语义搜索对话框控制器
 *
 * 管理 XHTML 窗口的生命周期，向窗口注入三个回调：
 *  - searchCallback(query) → SemanticSearchResult[]
 *  - openItemCallback(itemKey) → 在 Zotero 中定位条目
 *  - findSimilarCallback(itemKey, title) → 查找相似文献
 */
export class SemanticSearchDialog {
  private window: any = null;

  /**
   * 打开搜索对话框（单例，重复调用 focus 已有窗口）
   * @param initialQuery 可选初始查询，自动填充并搜索
   */
  async open(initialQuery?: string): Promise<void> {
    try {
      if (this.isWindowOpen()) {
        this.window.focus();
        await this.fillInitialQuery(initialQuery);
        return;
      }

      const mainWindow = Zotero.getMainWindow();

      // 构建窗口参数
      const windowArgs = {
        initialQuery: initialQuery || "",
        searchCallback: (query: string) => this.performSearch(query),
        openItemCallback: (itemKey: string) => this.locateItem(itemKey),
        findSimilarCallback: (itemKey: string, title: string) =>
          this.findSimilar(itemKey, title),
        VirtualizedTableHelper: VirtualizedTableHelper,
        resultUtils: RESULT_UTILS,
        isSemanticEnabled: () => isSemanticSearchEnabled(),
      };

      this.window = mainWindow.openDialog(
        DIALOG_URL,
        DIALOG_NAME,
        "chrome,centerscreen,resizable,dialog=no",
        windowArgs,
      );

      // 等待 DOM 与 Fluent 文案就绪，避免操作尚未构建的控件
      await this.waitForWindowReady();
      await this.fillInitialQuery(initialQuery);

      ztoolkit.log("[SemanticDialog] Search dialog opened");
    } catch (error) {
      ztoolkit.log(
        `[SemanticDialog] Failed to open dialog: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /**
   * 在查询框中填入初始查询并触发一次搜索，窗口未就绪时跳过。
   */
  private async fillInitialQuery(initialQuery?: string): Promise<void> {
    if (!initialQuery || !this.isWindowOpen()) return;
    const queryInput = this.window.document?.getElementById("zotseek-query-1");
    if (!queryInput) return;
    queryInput.value = initialQuery;
    await this.window.performSearch?.();
  }

  /**
   * 关闭对话框
   */
  close(): void {
    if (this.window && !this.window.closed) {
      this.window.close();
    }
    this.window = null;
  }

  /**
   * 检查窗口是否打开
   */
  private isWindowOpen(): boolean {
    return (
      this.window &&
      !this.window.closed &&
      typeof Components !== "undefined" &&
      !Components.utils.isDeadWrapper(this.window)
    );
  }

  /**
   * 执行语义搜索（注入到窗口的回调）
   *
   * 与 MCP 工具一致，每次调用都重新读取偏好，因此运行时关闭语义搜索后
   * 不会再把用户的查询与 API 密钥发送给 embedding 服务。
   */
  private async performSearch(query: string): Promise<SemanticSearchResult[]> {
    if (!isSemanticSearchEnabled()) {
      ztoolkit.log(
        `[SemanticDialog] Search skipped, ${PREF_SEMANTIC_ENABLED} is disabled`,
      );
      return [];
    }

    ztoolkit.log(`[SemanticDialog] Performing search: "${query}"`);

    const service = getSemanticSearchService();
    const results = await service.search(query, {
      topK: 50,
      minScore: 0.1,
    });

    ztoolkit.log(`[SemanticDialog] Found ${results.length} results`);
    return results;
  }

  /**
   * 查找与指定条目相似的文献
   */
  async findSimilar(itemKey: string, title?: string): Promise<void> {
    if (!isSemanticSearchEnabled()) {
      // 关闭后不再发送条目内容，同时收起可能已经打开的对话框。
      this.close();
      return;
    }

    // 确保对话框打开
    await this.open();

    ztoolkit.log(`[SemanticDialog] Finding similar to: ${title || itemKey}`);

    // 等待窗口初始化
    await this.waitForWindowReady();
    if (!this.isWindowOpen()) return;

    // 更新进度提示
    this.window?.showProgress?.(getString("semantic-searching"));

    try {
      const service = getSemanticSearchService();
      const results = await service.findSimilar(itemKey, { topK: 15 });

      // 通过窗口暴露的 displayResults 更新结果
      this.window?.displayResults?.(results);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.window?.showError?.(
        getString("semantic-search-error", { args: { error: msg } }),
      );
      ztoolkit.log(`[SemanticDialog] FindSimilar error: ${msg}`, "error");
    }
  }

  /**
   * 等待窗口 DOM、Fluent 文案与内联脚本就绪。
   *
   * 优先使用窗口自身暴露的 `_initPromise` 握手，因此不会再出现“内联脚本
   * 已定义但 DOM 尚未加载”的假就绪；握手失败时回退到带超时的轮询，
   * 避免窗口无法打开时无限等待。
   */
  private waitForWindowReady(): Promise<void> {
    const win = this.window;
    if (!win) return Promise.resolve();

    const handshake = win._initPromise;
    if (handshake && typeof handshake.then === "function") {
      return Promise.race([
        Promise.resolve(handshake).catch(() => undefined),
        this.delay(DIALOG_INIT_TIMEOUT_MS).then(() => {
          throw new Error(
            `Dialog ${DIALOG_NAME} did not finish initializing within ${DIALOG_INIT_TIMEOUT_MS}ms`,
          );
        }),
      ]);
    }

    return new Promise((resolve) => {
      if (!this.isWindowOpen()) return resolve();
      if ((win as any).performSearch) return resolve();
      const check = () => {
        if (!this.isWindowOpen()) {
          return resolve();
        }
        if ((win as any).performSearch) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 在 Zotero 条目列表中定位条目（注入到窗口的回调）
   */
  private async locateItem(itemKey: string): Promise<void> {
    try {
      const win = Zotero.getActiveZoteroPane();
      if (!win) return;

      for (const library of Zotero.Libraries.getAll()) {
        const item = await Zotero.Items.getByLibraryAndKeyAsync(
          library.libraryID,
          itemKey,
        );
        if (item) {
          await Promise.resolve(win.selectItem(item.id));
          return;
        }
      }
    } catch (e) {
      ztoolkit.log(
        `[SemanticDialog] Failed to locate item ${itemKey}: ${e}`,
        "warn",
      );
    }
  }
}

// ============ 单例 ============

let dialogInstance: SemanticSearchDialog | null = null;

export function getSemanticSearchDialog(): SemanticSearchDialog {
  if (!dialogInstance) {
    dialogInstance = new SemanticSearchDialog();
  }
  return dialogInstance;
}

// ============ 偏好观察 ============

/**
 * 注册语义搜索开关的偏好观察者。
 *
 * 对话框本身没有偏好监听，运行中关闭语义搜索后工具栏按钮与菜单不会消失，
 * 对话框仍会把查询与 API 密钥发送给 embedding 服务。观察者在开关变化时
 * 统一增删界面并关闭对话框，与 MCP 工具每次调用都检查偏好的行为对齐。
 */
export function registerSemanticSearchPrefObserver(): void {
  try {
    if (semanticPrefObserverID) return;
    semanticPrefObserverID = Zotero.Prefs.registerObserver(
      PREF_SEMANTIC_ENABLED,
      () => applySemanticSearchPrefToWindows(),
    );
    ztoolkit.log("[SemanticDialog] Preference observer registered");
  } catch (error) {
    ztoolkit.log(
      `[SemanticDialog] Failed to register the semantic search preference observer: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}

/** 注销偏好观察者，供 shutdown 调用。 */
export function unregisterSemanticSearchPrefObserver(): void {
  if (!semanticPrefObserverID) return;
  try {
    Zotero.Prefs.unregisterObserver(semanticPrefObserverID);
    ztoolkit.log("[SemanticDialog] Preference observer unregistered");
  } catch (error) {
    ztoolkit.log(
      `[SemanticDialog] Failed to unregister the semantic search preference observer: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  } finally {
    semanticPrefObserverID = null;
  }
}

function applySemanticSearchPrefToWindows(): void {
  const enabled = isSemanticSearchEnabled();
  for (const win of Zotero.getMainWindows()) {
    try {
      if (enabled) {
        registerSemanticSearchToolbar(win);
        registerFindSimilarMenu(win);
      } else {
        unregisterSemanticSearchUI(win as unknown as Window);
      }
    } catch (error) {
      ztoolkit.log(
        `[SemanticDialog] Failed to apply the semantic search preference: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }
}

// ============ UI 注册函数 ============

/**
 * 在 Zotero 主工具栏注册语义搜索按钮。
 *
 * 参考 ZotSeek 实现：使用 #zotero-items-toolbar 容器，插入到搜索框之前。
 *
 * 任何 DOM 改动都包在 try/catch 中：主窗口加载失败会中断插件启动，
 * 而 Zotero 已把条目工具栏移入 `library-view`，搜索框不再是工具栏的直接子节点。
 */
export function registerSemanticSearchToolbar(
  win: _ZoteroTypes.MainWindow,
): void {
  try {
    const doc = win.document;

    const semanticEnabled = isSemanticSearchEnabled();
    if (!semanticEnabled) {
      doc.getElementById(TOOLBAR_BUTTON_ID)?.remove();
      doc.getElementById(TOOLBAR_SEPARATOR_ID)?.remove();
      return;
    }

    // 先清理已有
    doc.getElementById(TOOLBAR_BUTTON_ID)?.remove();
    doc.getElementById(TOOLBAR_SEPARATOR_ID)?.remove();

    // 查找条目工具栏（Zotero 的正确 ID）
    const toolbar = doc.getElementById("zotero-items-toolbar");
    if (!toolbar) {
      ztoolkit.log(
        "[SemanticDialog] zotero-items-toolbar not found, skipping button registration",
      );
      return;
    }

    // 创建分隔线
    const separator = doc.createXULElement("toolbarseparator");
    separator.id = TOOLBAR_SEPARATOR_ID;

    // 创建按钮
    const button = doc.createXULElement("toolbarbutton");
    button.id = TOOLBAR_BUTTON_ID;
    button.setAttribute("label", getString("semantic-search-title"));
    button.setAttribute("tooltiptext", getString("semantic-search-tooltip"));
    button.setAttribute("class", "zotero-tb-button");

    // 使用 ZotSeek 风格的大脑+放大镜图标
    (button as any).style.listStyleImage =
      `url("chrome://${config.addonRef}/content/icons/icon-toolbar.svg")`;

    button.addEventListener("command", () => {
      getSemanticSearchDialog().open();
    });

    // 插入到搜索框之前。搜索框在部分 Zotero 版本中是 `library-view` 的
    // 直接子节点而非工具栏的直接子节点，`toolbar.insertBefore` 会因此抛错，
    // 这里改用搜索框自身的父节点。
    const searchBox = toolbar.querySelector("#zotero-tb-search");
    const parent = searchBox?.parentNode;
    if (searchBox && parent) {
      parent.insertBefore(separator, searchBox);
      parent.insertBefore(button, separator);
    } else {
      toolbar.appendChild(button);
      toolbar.appendChild(separator);
    }

    ztoolkit.log("[SemanticDialog] Toolbar button registered");
  } catch (error) {
    ztoolkit.log(
      `[SemanticDialog] Toolbar registration failed: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}

/**
 * 在条目右键菜单注册“查找相似文献”。
 *
 * 菜单项仅在恰好选中一个常规条目时可见：对笔记、附件或多选状态
 * 执行语义搜索没有意义。
 */
export function registerFindSimilarMenu(win: _ZoteroTypes.MainWindow): void {
  try {
    const doc = win.document;

    const semanticEnabled = isSemanticSearchEnabled();
    if (!semanticEnabled) {
      doc.getElementById(CONTEXT_MENU_FIND_SIMILAR_ID)?.remove();
      doc.getElementById(CONTEXT_MENU_SEPARATOR_ID)?.remove();
      return;
    }

    // 先清理
    doc.getElementById(CONTEXT_MENU_FIND_SIMILAR_ID)?.remove();
    doc.getElementById(CONTEXT_MENU_SEPARATOR_ID)?.remove();

    const itemMenu = doc.getElementById("zotero-itemmenu");
    if (!itemMenu) {
      ztoolkit.log(
        "[SemanticDialog] Item menu not found, skipping find-similar registration",
      );
      return;
    }

    // 分隔线
    const separator = doc.createXULElement("menuseparator");
    separator.id = CONTEXT_MENU_SEPARATOR_ID;

    // 菜单项
    const menuItem = doc.createXULElement("menuitem") as any;
    menuItem.id = CONTEXT_MENU_FIND_SIMILAR_ID;
    menuItem.setAttribute("label", getString("menu-find-similar"));
    menuItem.addEventListener("command", async () => {
      const zoteroPane = win.ZoteroPane;
      if (!zoteroPane) return;

      const selectedItems = zoteroPane.getSelectedItems();
      if (!selectedItems || selectedItems.length === 0) return;

      const item = selectedItems[0];
      const title = item.getDisplayTitle?.() || "";
      getSemanticSearchDialog().findSimilar(item.key, title);
    });

    const popupHandler: EventListener = () => {
      const selectedItems = win.ZoteroPane?.getSelectedItems?.() || [];
      menuItem.hidden = !(
        selectedItems.length === 1 && selectedItems[0].isRegularItem?.()
      );
    };
    itemMenu.addEventListener("popupshowing", popupHandler);
    itemMenuHandlers.set(itemMenu, popupHandler);

    itemMenu.appendChild(separator);
    itemMenu.appendChild(menuItem);
    ztoolkit.log("[SemanticDialog] Find-similar context menu registered");
  } catch (error) {
    ztoolkit.log(
      `[SemanticDialog] Find-similar menu registration failed: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}

/**
 * 卸载所有 UI 元素
 */
export function unregisterSemanticSearchUI(win: Window): void {
  try {
    const doc = (win as any).document;
    if (!doc) return;

    // 关闭对话框
    getSemanticSearchDialog().close();

    // 移除右键菜单的可见性监听
    const itemMenu = doc.getElementById("zotero-itemmenu");
    const handler = itemMenu ? itemMenuHandlers.get(itemMenu) : undefined;
    if (itemMenu && handler) {
      itemMenu.removeEventListener("popupshowing", handler);
      itemMenuHandlers.delete(itemMenu);
    }

    // 移除 UI 元素
    for (const id of SEMANTIC_DIALOG_ELEMENT_IDS) {
      doc.getElementById(id)?.remove();
    }
  } catch {
    // window may already be gone
  }
}
