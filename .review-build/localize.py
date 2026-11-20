from pathlib import Path
import json, re, subprocess
# Read original bilingual text from the pinned source, not a copied runtime table.
original=subprocess.check_output(['git','show','dd6d06b:zotero-mcp-plugin/addon/content/searchDialog.xhtml'],text=True)
obj=original.split('const I18N = ',1)[1].split('\n\n    function getLocale',1)[0].strip().rstrip(';')
locales=json.loads(subprocess.check_output(['node','-e','console.log(JSON.stringify('+obj+'))'],text=True))
keys=list(locales['en-US'])
translations={
'de-DE': '''Semantische Suche|Suchen:|Suchbegriff eingeben; für semantische Suche Eingabetaste drücken|Weitere Abfrage mit UND/ODER verknüpfen|Suchen|Abfrage 2:|Abfrage 3:|Abfrage 4:|Abfrage entfernen|Modus:|Hybrid|Nur semantisch|Nur Schlüsselwörter|Trefferart: beide Suchen, semantisch oder Schlüsselwort|Semantische Übereinstimmung|Nur Schlüsselworttreffer|Ergebnisse:|Nach Dokument|Nach Textabschnitt|Einstellungen|Einstellungen öffnen|Ergebnisse als Sammlung speichern|Auswahl öffnen|Schließen|Suche läuft…|Keine Einträge gefunden|Bitte eine Suchabfrage eingeben.|{count} Einträge aus {matches} Treffern|Alle Abfragen müssen zutreffen|Mindestens eine Abfrage muss zutreffen|mit|Minimum|Produkt|Mittelwert|Ähnlichkeit|Titel|Autoren|Jahr|Textabschnitt|Typ|Semantisch|Schlüsselwort|Beide|Trefferarten:|{count} Einträge in Sammlung {name} gespeichert|Sammlung konnte nicht gespeichert werden: {error}|Suche fehlgeschlagen: {error}|Die Einstellungen befinden sich in den Einstellungen des Zotero-MCP-Plugins.|Textvorschau|Textabschnitt {n}|Ähnlichkeit|Keine Textvorschau verfügbar''',
'es-ES': '''Búsqueda semántica|Buscar:|Escriba una consulta; pulse Intro para la búsqueda semántica|Añadir otra consulta con Y/O|Buscar|Consulta 2:|Consulta 3:|Consulta 4:|Eliminar esta consulta|Modo:|Híbrido|Solo semántica|Solo palabras clave|Tipo: ambas búsquedas, semántica o palabras clave|Coincidencia semántica|Solo coincidencias de palabras clave|Resultados:|Por documento|Por fragmento|Configuración|Abrir configuración|Guardar resultados como colección|Abrir selección|Cerrar|Buscando…|No se encontraron elementos|Introduzca una consulta.|{count} elementos de {matches} coincidencias|Deben coincidir todas las consultas|Basta con coincidir con una consulta|usando|Mínimo|Producto|Promedio|Similitud|Título|Autores|Año|Fragmento|Tipo|Semántica|Palabra clave|Ambas|Tipos de coincidencia:|Se guardaron {count} elementos en la colección {name}|No se pudo guardar la colección: {error}|Error de búsqueda: {error}|La configuración se gestiona en las preferencias del complemento Zotero MCP.|Vista previa|Fragmento {n}|Similitud|No hay vista previa disponible''',
'fr-FR': '''Recherche sémantique|Rechercher :|Saisir une requête ; appuyer sur Entrée pour la recherche sémantique|Ajouter une requête avec ET/OU|Rechercher|Requête 2 :|Requête 3 :|Requête 4 :|Supprimer cette requête|Mode :|Hybride|Sémantique uniquement|Mots-clés uniquement|Type : les deux recherches, sémantique ou mots-clés|Correspondance sémantique|Correspondance par mots-clés uniquement|Résultats :|Par document|Par fragment|Paramètres|Ouvrir les paramètres|Enregistrer les résultats dans une collection|Ouvrir la sélection|Fermer|Recherche en cours…|Aucun document trouvé|Saisir une requête.|{count} documents pour {matches} correspondances|Toutes les requêtes doivent correspondre|Une requête correspondante suffit|avec|Minimum|Produit|Moyenne|Similarité|Titre|Auteurs|Année|Fragment|Type|Sémantique|Mot-clé|Les deux|Types de correspondance :|{count} documents enregistrés dans la collection {name}|Échec de l’enregistrement de la collection : {error}|Échec de la recherche : {error}|Les paramètres sont gérés dans les préférences du module Zotero MCP.|Aperçu du texte|Fragment {n}|Similarité|Aucun aperçu disponible''',
'ja-JP': '''意味検索|検索：|検索語を入力し、意味検索は Enter キーで実行|AND/OR で組み合わせる検索条件を追加|検索|検索条件 2：|検索条件 3：|検索条件 4：|この条件を削除|モード：|ハイブリッド|意味検索のみ|キーワードのみ|一致の種類：両方・意味・キーワード|意味に基づく一致|キーワードの一致のみ|結果：|文献ごと|テキストチャンクごと|設定|設定を開く|結果をコレクションに保存|選択項目を開く|閉じる|検索中…|項目が見つかりません|検索条件を入力してください。|{matches} 件の一致から {count} 件の項目|すべての条件に一致|いずれかの条件に一致|計算方法|最小値|積|平均|類似度|タイトル|著者|年|チャンク|種類|意味|キーワード|両方|一致の種類：|コレクション {name} に {count} 件を保存しました|コレクションの保存に失敗：{error}|検索に失敗：{error}|Zotero MCP プラグインの設定から変更できます。|テキストのプレビュー|チャンク {n}|類似度|プレビューはありません'''
}
for locale, line in translations.items():
    values=line.split('|'); assert len(values)==len(keys),(locale,len(values),len(keys))
    locales[locale]=dict(zip(keys, values))
locales['en-US'].update(placeholder='Enter a query; press Enter or Search for semantic/hybrid search',bySection='By document',byLocation='By text chunk',modeHybrid='Hybrid')
locales['zh-CN'].update(placeholder='输入查询；语义及混合搜索需按回车或点击搜索',bySection='按文献',byLocation='按文本块',modeHybrid='混合搜索')
extras={
'en-US':['Untitled','Table initialization failed','Semantic search is disabled','Finding similar documents…','OAuth enabled: use the authenticated port for public tunnels; the ordinary MCP port remains unauthenticated.'],
'zh-CN':['无标题','结果表初始化失败','语义搜索已关闭','正在查找相似文献…','OAuth 开启时，请将公网隧道指向鉴权端口；普通 MCP 端口仍免鉴权。'],
'de-DE':['Ohne Titel','Tabelle konnte nicht initialisiert werden','Semantische Suche ist deaktiviert','Ähnliche Dokumente werden gesucht…','Öffentliche Tunnel müssen den OAuth-Port verwenden; der normale MCP-Port bleibt ohne Authentifizierung.'],
'es-ES':['Sin título','Error al iniciar la tabla','La búsqueda semántica está desactivada','Buscando documentos similares…','Los túneles públicos deben usar el puerto OAuth; el puerto MCP normal sigue sin autenticación.'],
'fr-FR':['Sans titre','Échec de l’initialisation du tableau','La recherche sémantique est désactivée','Recherche de documents similaires…','Les tunnels publics doivent utiliser le port OAuth ; le port MCP ordinaire reste sans authentification.'],
'ja-JP':['タイトルなし','表の初期化に失敗しました','意味検索は無効です','類似文献を検索中…','公開トンネルは OAuth ポートを使用してください。通常の MCP ポートは認証不要のままです。']}
unused=['semantic-search-short-label','semantic-search-placeholder','semantic-search-btn','semantic-searching','semantic-search-hint','semantic-search-close','semantic-no-results','semantic-search-error','semantic-search-score','semantic-search-creators','semantic-search-year']
for locale, strings in locales.items():
    strings.update(dict(zip(['untitled','tableError','disabled','findingSimilar'],extras[locale][:4])))
    p=Path('zotero-mcp-plugin/addon/locale')/locale/'addon.ftl'
    s=p.read_text()
    for key in unused: s=re.sub(r'^'+re.escape(key)+r' = .*\n','',s,flags=re.M)
    s+='\n# Semantic dialog (shared Fluent messages)\n'
    for key,value in strings.items():
        key='semantic-dialog-'+re.sub(r'[A-Z]',lambda m:'-'+m[0].lower(),key)
        value=re.sub(r'\{(\w+)\}',r'{ $\1 }',value.strip())
        s+=f'{key} = {value}\n'
    p.write_text(s)
    p=p.with_name('preferences.ftl');s=p.read_text()
    s=re.sub(r'^pref-oauth-url-hint = .*$', 'pref-oauth-url-hint = '+extras[locale][4],s,flags=re.M)
    p.write_text(s)
# Replace unverified third-party SVG shapes with an original simple drawing.
Path('zotero-mcp-plugin/addon/content/icons/icon-toolbar.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!-- Original Zotero MCP search icon, MIT License. --><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M7 8h6M7 11h4"/></g></svg>\n''')
license_text='''# Third-party notices

The semantic-search dialog layout and interaction code are adapted from
ZotSeek (https://github.com/introfini/ZotSeek).
Copyright (c) 2025 José Fernandes. MIT License.
The replacement toolbar SVG is an original drawing, not an SVG Repo asset.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
'''
Path('zotero-mcp-plugin/addon/THIRD_PARTY_NOTICES.md').write_text(license_text)
for name in ['README.md','README-zh.md']:
    p=Path(name);p.write_text(p.read_text()+'\n\nSemantic-search UI adapted from ZotSeek, Copyright (c) 2025 José Fernandes, MIT License. See [third-party notices](zotero-mcp-plugin/addon/THIRD_PARTY_NOTICES.md).\n')
