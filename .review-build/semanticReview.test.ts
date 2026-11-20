import { expect } from 'chai';
import fs from 'node:fs';
import vm from 'node:vm';
import harness from './reviewHarness.cjs';
const { loadTS } = harness;
const scope: any = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync('addon/content/searchDialogHelpers.js', 'utf8'), scope);
const helpers = scope.module.exports;
function item(id = 1, libraryID = 1) { return { id, libraryID, key: 'KEY' + id, isRegularItem: () => true }; }
function storage(items = [item()]) {
  const calls: string[] = []; let transaction = false;
  const Zotero: any = {
    Libraries: { getAll: () => [{ libraryID: 1 }, { libraryID: 2 }], get: () => ({ editable: true }) },
    Items: { getByLibraryAndKeyAsync: async (libraryID: number, key: string) => items.find(i => i.libraryID === libraryID && i.key === key) },
    DB: { executeTransaction: async (fn: () => Promise<void>) => { transaction = true; try { await fn(); calls.push('commit'); } catch (e) { calls.push('rollback'); throw e; } finally { transaction = false; } } },
    Collection: class {
      async save() { expect(transaction).to.equal(true); calls.push('save'); }
      async addItems(ids: number[]) { expect(transaction).to.equal(true); await Promise.resolve(); calls.push('add:' + ids.join(',')); }
    },
  };
  return { Zotero, calls };
}
async function rejected(fn: () => Promise<unknown>, message: string) {
  let error: any; try { await fn(); } catch (e) { error = e; }
  expect(String(error)).to.include(message);
}
function fakeDOM() {
  const node = (kind: string, text = ''): any => ({ kind, textContent: text, children: [], appendChild(child: any) { this.children.push(child); return child; } });
  return { createDocumentFragment: () => node('fragment'), createTextNode: (text: string) => node('text', text), createElementNS: (_: string, tag: string) => node(tag) };
}

describe('Semantic dialog review regressions', () => {
  it('uses only matching fields in the OR search and awaits asynchronous items', async () => {
    const conditions: any[] = [];
    const Zotero = {
      Search: class { addCondition(...args: any[]) { conditions.push(args); } async search() { return [1, 2]; } },
      Items: { getAsync: async () => [item(), { isRegularItem: () => false }] },
    };
    const result = await helpers.keywordItems(Zotero, 'concrete', 1);
    expect(conditions.map(x => x[0])).to.deep.equal(['joinMode', 'title', 'creator', 'tag', 'abstractNote']);
    expect(result).to.have.length(1);
  });
  it('returns no unrelated items for a no-hit query', async () => {
    const Zotero = { Search: class { addCondition() {} async search() { return []; } }, Items: { getAsync: async () => [] } };
    expect(await helpers.keywordItems(Zotero, 'no-match', 1)).to.have.length(0);
  });
  it('awaits a single transaction, deduplicates and reports committed count', async () => {
    const f = storage();
    expect(await helpers.saveCollection(f.Zotero, [{ itemKey: 'KEY1' }, { itemKey: 'KEY1' }], 'result')).to.equal(1);
    expect(f.calls).to.deep.equal(['save', 'add:1', 'commit']);
  });
  it('propagates addItems failure instead of reporting success', async () => {
    const f = storage(); f.Zotero.Collection.prototype.addItems = async () => { throw new Error('DB failed'); };
    await rejected(() => helpers.saveCollection(f.Zotero, [{ itemKey: 'KEY1' }], 'result'), 'DB failed');
    expect(f.calls).to.deep.equal(['save', 'rollback']);
  });
  it('does not create an empty collection', async () => {
    const f = storage(); await rejected(() => helpers.saveCollection(f.Zotero, [], 'result'), 'empty-results');
    expect(f.calls).to.have.length(0);
  });
  it('saves a group-library result into that same editable library', async () => {
    const f = storage([item(2, 2)]);
    expect(await helpers.saveCollection(f.Zotero, [{ itemKey: 'KEY2', libraryID: 2 }], 'group')).to.equal(1);
  });
  it('rejects mixed libraries before creating anything', async () => {
    const f = storage([item(1, 1), item(2, 2)]);
    await rejected(() => helpers.saveCollection(f.Zotero, [{ itemKey: 'KEY1' }, { itemKey: 'KEY2' }], 'mixed'), 'mixed-libraries');
    expect(f.calls).to.have.length(0);
  });
  it('rejects read-only libraries', async () => {
    const f = storage(); f.Zotero.Libraries.get = () => ({ editable: false });
    await rejected(() => helpers.saveCollection(f.Zotero, [{ itemKey: 'KEY1' }], 'readonly'), 'read-only-library');
  });
  it('rejects ambiguous keys across libraries', async () => {
    const f = storage([item(1, 1), item(1, 2)]);
    await rejected(() => helpers.saveCollection(f.Zotero, [{ itemKey: 'KEY1' }], 'ambiguous'), 'missing-or-ambiguous-item');
  });
  it('rejects missing results rather than partially saving', async () => {
    const f = storage(); await rejected(() => helpers.saveCollection(f.Zotero, [{ itemKey: 'MISSING' }], 'missing'), 'missing-or-ambiguous-item');
  });
  for (const term of ['amp', 'lt', 'quot', '混凝土']) {
    it('builds safe text nodes for highlight term ' + term, () => {
      const text = '& < > " ' + term;
      const result = helpers.highlight(fakeDOM(), text, [term]);
      expect(result.children.map((x: any) => x.textContent).join('')).to.equal(text);
      expect(result.children.some((x: any) => x.kind === 'mark')).to.equal(true);
    });
  }
  it('parses the entire dialog script and includes stale-result protection', () => {
    const text = fs.readFileSync('addon/content/searchDialog.xhtml', 'utf8');
    new vm.Script(text.split('<![CDATA[')[1].split(']]>')[0]);
    expect(text).to.include('sequence !== searchSequence');
    expect(text).not.to.include('const I18N');
    expect(text).not.to.include('snippetTooltip.innerHTML');
  });
  it('has identical Fluent dialog keys in all six shipped locales', () => {
    const locales = ['en-US', 'zh-CN', 'de-DE', 'es-ES', 'fr-FR', 'ja-JP'];
    const keys = locales.map(locale => [...fs.readFileSync(`addon/locale/${locale}/addon.ftl`, 'utf8').matchAll(/^(semantic-dialog-[\w-]+) = /gm)].map(x => x[1]).sort());
    expect(keys[0].length).to.be.greaterThan(50);
    for (const values of keys) expect(values).to.deep.equal(keys[0]);
  });
});

describe('Semantic controller lifecycle', () => {
  function fixture() {
    let enabled = false, calls = 0, observer: any, unregistered = 0;
    const api = loadTS('src/modules/semanticSearchDialog.ts', {
      'zotero-plugin-toolkit': { VirtualizedTableHelper: class {} },
      '../../package.json': { config: { addonRef: 'test' } },
      '../utils/locale': { getString: (key: string) => key },
      './semantic': { getSemanticSearchService: () => ({ search: async () => { calls++; return []; }, findSimilar: async () => { calls++; return []; } }) },
    }, {
      Zotero: { Prefs: { get: () => enabled, registerObserver: (_: string, cb: any) => { observer = cb; return Symbol(); }, unregisterObserver: () => { unregistered++; } }, getMainWindows: () => [], getMainWindow: () => { throw new Error('Must not open while disabled'); } },
      ztoolkit: { log() {} },
    });
    return { api, calls: () => calls, disable: () => { enabled = false; observer(); }, unregistered: () => unregistered };
  }
  it('does not send queries after the preference is disabled', async () => {
    const f = fixture(), dialog = new f.api.SemanticSearchDialog();
    await rejected(() => dialog.performSearch('query'), 'disabled');
    await dialog.findSimilar('KEY'); expect(f.calls()).to.equal(0);
  });
  it('registers an observer once and unregisters on shutdown', () => {
    const f = fixture(); f.api.registerSemanticPreferenceObserver(); f.api.registerSemanticPreferenceObserver();
    f.disable(); f.api.unregisterSemanticPreferenceObserver(); expect(f.unregistered()).to.equal(1);
  });
  it('isolates DOM failures instead of aborting startup', () => {
    const f = fixture(), win = { document: { getElementById() { throw new Error('DOM changed'); } } };
    expect(() => f.api.registerSemanticSearchToolbar(win)).not.to.throw();
    expect(() => f.api.registerFindSimilarMenu(win)).not.to.throw();
  });
});
