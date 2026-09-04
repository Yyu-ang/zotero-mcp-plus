import { config } from "../../package.json";
import {
  getSemanticSearchService,
  type SemanticSearchResult,
} from "./semantic";
import { getString } from "../utils/locale";

const PREF_SEMANTIC_ENABLED =
  "extensions.zotero.zotero-mcp-plugin.semantic.enabled";
const DIALOG_URL = `chrome://${config.addonRef}/content/searchDialog.xhtml`;
const DIALOG_NAME = `${config.addonRef}-semantic-search-dialog`;
const TOOLBAR_BUTTON_ID = `${config.addonRef}-semantic-search-button`;
const TOOLBAR_SEPARATOR_ID = `${config.addonRef}-semantic-search-separator`;
const CONTEXT_MENU_ID = `${config.addonRef}-find-similar`;
const CONTEXT_MENU_SEPARATOR_ID = `${config.addonRef}-find-similar-separator`;
const ICON_URL = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;

export const SEMANTIC_DIALOG_ELEMENT_IDS = [
  TOOLBAR_BUTTON_ID,
  TOOLBAR_SEPARATOR_ID,
  CONTEXT_MENU_ID,
  CONTEXT_MENU_SEPARATOR_ID,
];

function semanticEnabled(): boolean {
  return Zotero.Prefs.get(PREF_SEMANTIC_ENABLED, true) !== false;
}

function dialogStrings(): Record<string, string> {
  return {
    title: getString("semantic-search-title" as any),
    placeholder: getString("semantic-search-placeholder" as any),
    search: getString("semantic-search-btn" as any),
    searching: getString("semantic-searching" as any),
    hint: getString("semantic-search-hint" as any),
    close: getString("semantic-search-close" as any),
    noResults: getString("semantic-no-results" as any),
    searchError: getString("semantic-search-error" as any),
    score: getString("semantic-search-score" as any),
    creators: getString("semantic-search-creators" as any),
    year: getString("semantic-search-year" as any),
  };
}

export class SemanticSearchDialog {
  private window: any = null;

  open(initialQuery = ""): void {
    if (!semanticEnabled()) {
      ztoolkit.log(
        "[SemanticDialog] Semantic search is disabled; dialog not opened",
      );
      return;
    }

    if (this.isWindowOpen()) {
      this.window.focus();
      this.window.setQuery?.(initialQuery);
      return;
    }

    const mainWindow = Zotero.getMainWindow();
    this.window = mainWindow.openDialog(
      DIALOG_URL,
      DIALOG_NAME,
      "chrome,centerscreen,resizable,dialog=no",
      {
        initialQuery,
        strings: dialogStrings(),
        searchCallback: (query: string) => this.performSearch(query),
        openItemCallback: (itemKey: string) => this.locateItem(itemKey),
        findSimilarCallback: (itemKey: string) => this.findSimilar(itemKey),
      },
    );
  }

  close(): void {
    if (this.isWindowOpen()) {
      this.window.close();
    }
    this.window = null;
  }

  async findSimilar(itemKey: string): Promise<void> {
    if (!semanticEnabled()) return;
    this.open();
    await this.waitForWindowReady();
    this.window?.setBusy?.(true);
    try {
      const results = await getSemanticSearchService().findSimilar(itemKey, {
        topK: 25,
        minScore: 0.1,
      });
      this.window?.displayResults?.(results);
    } catch (error) {
      this.window?.showError?.(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.window?.setBusy?.(false);
    }
  }

  private isWindowOpen(): boolean {
    if (!this.window || this.window.closed) return false;
    try {
      return !Components.utils.isDeadWrapper(this.window);
    } catch {
      return false;
    }
  }

  private async waitForWindowReady(timeoutMs = 5000): Promise<void> {
    const started = Date.now();
    while (this.isWindowOpen() && !this.window?.displayResults) {
      if (Date.now() - started >= timeoutMs) {
        throw new Error("Semantic search dialog did not initialize in time");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async performSearch(query: string): Promise<SemanticSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    return getSemanticSearchService().search(normalized, {
      topK: 50,
      minScore: 0.1,
    });
  }

  private async locateItem(itemKey: string): Promise<void> {
    const pane = Zotero.getActiveZoteroPane();
    if (!pane) return;

    for (const library of Zotero.Libraries.getAll()) {
      const item = await Zotero.Items.getByLibraryAndKeyAsync(
        library.libraryID,
        itemKey,
      );
      if (item) {
        await pane.selectItem(item.id);
        return;
      }
    }

    ztoolkit.log(
      `[SemanticDialog] Could not locate item ${itemKey} in any library`,
      "warn",
    );
  }
}

let dialogInstance: SemanticSearchDialog | null = null;

export function getSemanticSearchDialog(): SemanticSearchDialog {
  if (!dialogInstance) dialogInstance = new SemanticSearchDialog();
  return dialogInstance;
}

export function registerSemanticSearchToolbar(
  win: _ZoteroTypes.MainWindow,
): void {
  const doc = win.document;
  doc.getElementById(TOOLBAR_BUTTON_ID)?.remove();
  doc.getElementById(TOOLBAR_SEPARATOR_ID)?.remove();
  if (!semanticEnabled()) return;

  const toolbar = doc.getElementById("zotero-items-toolbar");
  if (!toolbar) return;

  const button = doc.createXULElement("toolbarbutton");
  button.id = TOOLBAR_BUTTON_ID;
  button.setAttribute("label", getString("semantic-search-short-label" as any));
  button.setAttribute(
    "tooltiptext",
    getString("semantic-search-tooltip" as any),
  );
  button.setAttribute("class", "zotero-tb-button");
  (button as any).style.listStyleImage = `url("${ICON_URL}")`;
  button.addEventListener("command", () => getSemanticSearchDialog().open());

  const separator = doc.createXULElement("toolbarseparator");
  separator.id = TOOLBAR_SEPARATOR_ID;
  const searchBox = toolbar.querySelector("#zotero-tb-search");
  toolbar.insertBefore(button, searchBox || null);
  toolbar.insertBefore(separator, searchBox || null);
}

export function registerFindSimilarMenu(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;
  doc.getElementById(CONTEXT_MENU_ID)?.remove();
  doc.getElementById(CONTEXT_MENU_SEPARATOR_ID)?.remove();
  if (!semanticEnabled()) return;

  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (!itemMenu) return;

  const separator = doc.createXULElement("menuseparator");
  separator.id = CONTEXT_MENU_SEPARATOR_ID;
  const menuItem = doc.createXULElement("menuitem");
  menuItem.id = CONTEXT_MENU_ID;
  menuItem.setAttribute("label", getString("menu-find-similar" as any));
  menuItem.addEventListener("command", async () => {
    const selected = win.ZoteroPane?.getSelectedItems?.() || [];
    const item = selected[0];
    if (item?.key) await getSemanticSearchDialog().findSimilar(item.key);
  });

  itemMenu.appendChild(separator);
  itemMenu.appendChild(menuItem);
}

export function unregisterSemanticSearchUI(win: Window): void {
  try {
    getSemanticSearchDialog().close();
    const doc = win.document;
    for (const id of SEMANTIC_DIALOG_ELEMENT_IDS) {
      doc.getElementById(id)?.remove();
    }
  } catch {
    // Window may already be torn down.
  }
}
