/* Original helpers for the Zotero MCP semantic dialog, MIT License. */
var SemanticDialogHelpers = {
  async keywordItems(Zotero, query, libraryID) {
    const search = new Zotero.Search();
    search.libraryID = libraryID;
    search.addCondition('joinMode', 'any');
    for (const field of ['title', 'creator', 'tag', 'abstractNote']) search.addCondition(field, 'contains', query);
    const ids = await search.search();
    const items = await Zotero.Items.getAsync(ids);
    return items.filter(item => item && item.isRegularItem()).slice(0, 100);
  },
  async resolveItems(Zotero, results) {
    const items = new Map();
    for (const result of results) {
      const candidates = [];
      const libraries = result.libraryID !== undefined
        ? [{ libraryID: result.libraryID }] : Zotero.Libraries.getAll();
      for (const library of libraries) {
        const item = await Zotero.Items.getByLibraryAndKeyAsync(library.libraryID, result.itemKey);
        if (item) candidates.push(item);
      }
      if (candidates.length !== 1) throw new Error('missing-or-ambiguous-item');
      if (candidates[0].isRegularItem()) items.set(candidates[0].id, candidates[0]);
    }
    return [...items.values()];
  },
  async saveCollection(Zotero, results, name) {
    const items = await this.resolveItems(Zotero, results);
    if (!items.length) throw new Error('empty-results');
    const libraryID = items[0].libraryID;
    if (items.some(item => item.libraryID !== libraryID)) throw new Error('mixed-libraries');
    if (Zotero.Libraries.get(libraryID)?.editable === false) throw new Error('read-only-library');
    const collection = new Zotero.Collection();
    collection.libraryID = libraryID;
    collection.name = name;
    await Zotero.DB.executeTransaction(async () => {
      await collection.save();
      await collection.addItems(items.map(item => item.id));
    });
    return items.length;
  },
  highlight(document, text, terms) {
    const fragment = document.createDocumentFragment();
    const source = String(text);
    const lower = source.toLowerCase();
    const normalized = [...new Set(terms.map(term => String(term).toLowerCase()).filter(Boolean))]
      .sort((a, b) => b.length - a.length);
    let offset = 0;
    while (offset < source.length) {
      let position = source.length, match = '';
      for (const term of normalized) {
        const found = lower.indexOf(term, offset);
        if (found >= 0 && (found < position || (found === position && term.length > match.length))) {
          position = found; match = term;
        }
      }
      if (position > offset) fragment.appendChild(document.createTextNode(source.slice(offset, position)));
      if (!match) break;
      const mark = document.createElementNS('http://www.w3.org/1999/xhtml', 'mark');
      mark.textContent = source.slice(position, position + match.length);
      fragment.appendChild(mark);
      offset = position + match.length;
    }
    return fragment;
  }
};
if (typeof module !== 'undefined') module.exports = SemanticDialogHelpers;
