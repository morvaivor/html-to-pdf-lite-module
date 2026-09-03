# ⚡ Plan d'optimisation — `html-to-pdf-lite-module`

> **Philosophie** : rester léger (0 dépendance lourde), rapide, et peu gourmand en mémoire.
> Chaque optimisation doit être **testable unitairement** et **évolutive** (ne pas créer de dette technique).

---

## Table des matières

1. [Éliminer le double rendu (two-pass)](#1-éliminer-le-double-rendu-two-pass)
2. [Cache des styles inline parsés](#2-cache-des-styles-inline-parsés)
3. [Pré-calculer le layout des pages](#3-pré-calculer-le-layout-des-pages)
4. [Streaming du buffer PDF](#4-streaming-du-buffer-pdf)
5. [Pool d'objets pour les cellules de tableau](#5-pool-dobjets-pour-les-cellules-de-tableau)
6. [Lazy loading des images](#6-lazy-loading-des-images)
7. [Compilation unique des regex CSS](#7-compilation-unique-des-regex-css)
8. [Réduire les traversées DOM](#8-réduire-les-traversées-dom)
9. [Éviter les allocations dans les boucles chaudes](#9-éviter-les-allocations-dans-les-boucles-chaudes)
10. [Cache de mesure de texte](#10-cache-de-mesure-de-texte)
11. [Architecture modulaire pour le tree-shaking](#11-architecture-modulaire-pour-le-tree-shaking)
12. [Mode « fast » sans compteurs de page](#12-mode--fast--sans-compteurs-de-page)
13. [Résumé et priorisation](#13-résumé-et-priorisation)

---

## 1. Éliminer le double rendu (two-pass)

### Problème

C'est le **goulot d'étranglement n°1**. Actuellement, le rendu est effectué **2 fois** :

```
countPages()       → passe 1 : crée un PDFDocument, parse le HTML, applique le CSS, traverse tout le DOM
renderHtmlToPdf()  → passe 2 : recrée un PDFDocument, re-parse le HTML, re-applique le CSS, re-traverse tout le DOM
```

Cela signifie :
- **2× parsing HTML** (cheerio.load)
- **2× application CSS** (applyCssToElements)
- **2× traversée du DOM** complet
- **2× mesure de tout le texte** (measureTextHeight)
- **2× rendu des images** (chargement, décodage)
- **2× création de PDFDocument** (allocation mémoire significative)

La passe 1 existe **uniquement** pour résoudre `counter(num-pages)` dans les zones `@page`.

### Solution A — Rendu en une passe avec post-remplacement

Effectuer un **seul rendu** avec un placeholder pour `counter(num-pages)`, puis patcher le PDF binaire en fin de génération.

```js
// Concept : réserver un espace fixe pour le numéro
const PLACEHOLDER = '###'; // 3 caractères = assez pour "999" pages

// En fin de rendu, remplacer dans le buffer
function patchPageCount(buffer, totalPages) {
  const placeholder = Buffer.from(PLACEHOLDER);
  const replacement = Buffer.from(String(totalPages).padStart(3));
  let offset = 0;
  while ((offset = buffer.indexOf(placeholder, offset)) !== -1) {
    replacement.copy(buffer, offset);
    offset += replacement.length;
  }
  return buffer;
}
```

**Gain estimé** : ~50% du temps total, ~40% de la mémoire pic.

**Testabilité** : Tester que les placeholders sont correctement remplacés pour 1, 10, 100, 999 pages.

### Solution B — Passe 1 allégée (quick measure)

Si le post-remplacement est trop risqué, alléger la passe 1 :

```js
async function quickCountPages(html, options) {
  // Réutiliser le DOM déjà parsé (ne pas re-appeler cheerio.load)
  // Ne pas rendre les images (juste compter leur hauteur)
  // Ne pas enregistrer les polices (utiliser des mesures approximatives)
  // Ne pas créer de PDFDocument (utiliser un calcul purement arithmétique)
}
```

**Gain estimé** : ~30% du temps total.

### Solution C — Conditional two-pass

Ne faire la passe 1 **que si** `counter(num-pages)` est utilisé :

```js
const needsPageCount = pageZones && JSON.stringify(pageZones).includes('counter');
const totalPages = needsPageCount ? await countPages(html, renderOptions) : 0;
```

**Gain estimé** : 50% du temps pour les cas sans `counter(num-pages)` (la majorité).

**Testabilité** : Vérifier que le compteur est correct quand présent, et que le rendu est identique quand absent.

> **Recommandation** : Implémenter **C** immédiatement (facile, sans risque), puis **A** pour la v2.

---

## 2. Cache des styles inline parsés

### Problème

`parseInlineStyle()` est appelé **à chaque nœud** du DOM, et parfois **plusieurs fois pour le même élément** :

```js
// Dans renderTable, ligne 526-530 : parseInlineStyle est appelé 3 FOIS pour la même cellule
const cellStyle = {
  ...parentStyle,
  ...parseInlineStyle(cell),                                    // appel 1
  fontSize: parseInlineStyle(cell).fontSize ?? ...,             // appel 2
  bold: cell.name === 'th' || parseInlineStyle(cell).bold || .. // appel 3
};
```

Chaque appel re-parse la string `style="..."`, re-split sur `;`, re-switch sur chaque propriété.

### Solution — WeakMap cache

```js
const styleCache = new WeakMap();

function parseInlineStyle(element) {
  if (styleCache.has(element)) return styleCache.get(element);

  const style = parseInlineStyleUncached(element);
  styleCache.set(element, style);
  return style;
}
```

**Pourquoi WeakMap** :
- Pas besoin de vider le cache manuellement
- Les éléments DOM sont GC quand Cheerio libère le DOM
- Zero overhead mémoire une fois le DOM libéré

**Gain estimé** : ~15-20% sur les documents avec beaucoup de tableaux.

**Testabilité** :
- Vérifier que le même objet est retourné pour le même élément
- Vérifier que le cache est automatiquement vidé (test avec `global.gc()`)
- Benchmark avant/après sur un tableau de 100 lignes

---

## 3. Pré-calculer le layout des pages

### Problème

Les marges, dimensions de contenu et seuils de pagination sont **recalculés dans chaque fonction** :

```js
// Ce bloc est dupliqué dans : renderText, renderImage, renderList, renderTable
const leftMargin = options.margin?.left ?? 20;
const rightMargin = options.margin?.right ?? 20;
const topMargin = options.margin?.top ?? 20;
const bottomMargin = options.margin?.bottom ?? 20;
const footerHeight = options._footerHeight ?? 0;
const headerHeight = options._headerHeight ?? 0;
const contentWidth = doc.page.width - leftMargin - rightMargin;
const pageBottom = doc.page.height - bottomMargin - footerHeight;
```

### Solution — Objet `PageLayout` pré-calculé

```js
class PageLayout {
  constructor(doc, options) {
    this.leftMargin = options.margin?.left ?? 20;
    this.rightMargin = options.margin?.right ?? 20;
    this.topMargin = options.margin?.top ?? 20;
    this.bottomMargin = options.margin?.bottom ?? 20;
    this.headerHeight = options._headerHeight ?? 0;
    this.footerHeight = options._footerHeight ?? 0;
    this.pageWidth = doc.page.width;
    this.pageHeight = doc.page.height;

    // Pré-calculés
    this.contentWidth = this.pageWidth - this.leftMargin - this.rightMargin;
    this.contentTop = this.topMargin + this.headerHeight;
    this.pageBottom = this.pageHeight - this.bottomMargin - this.footerHeight;
    this.contentHeight = this.pageBottom - this.contentTop;
  }
}

// Usage
function renderText(doc, text, style, layout) {
  // Accès direct : layout.contentWidth, layout.pageBottom, etc.
}
```

**Avantages** :
- Élimine ~50 accès `optional chaining` (`?.`) par page
- Un seul point de vérité pour la géométrie
- **Testable** : instancier `PageLayout` indépendamment et vérifier les calculs

**Gain estimé** : ~5% global (micro-optimisation, mais propreté architecturale majeure).

---

## 4. Streaming du buffer PDF

### Problème

Le buffer PDF est assemblé en mémoire via un tableau de chunks :

```js
const buffers = [];
doc.on('data', (chunk) => buffers.push(chunk));
// ...
doc.on('end', () => resolve(Buffer.concat(buffers)));
```

Pour un PDF de 10 Mo, on a en mémoire :
- Les chunks individuels (~10 Mo)
- Le buffer concaténé final (~10 Mo)
- Pic mémoire : **~20 Mo** juste pour le buffer

### Solution — API stream en option

Ajouter une méthode `generateStream()` qui retourne un `Readable` au lieu d'un `Buffer` :

```js
class PdfGenerator {
  async generateStream(html, options = {}) {
    // Retourne doc (qui est un ReadableStream) directement
    // L'appelant peut pipe vers un fichier, une réponse HTTP, etc.
  }

  async generate(html, options = {}) {
    // Garde le comportement actuel pour la rétrocompatibilité
    const stream = await this.generateStream(html, options);
    return streamToBuffer(stream);
  }
}
```

**Usage** :

```js
const stream = await generator.generateStream(html);
stream.pipe(fs.createWriteStream('output.pdf'));
// Ou
stream.pipe(res); // Express response
```

**Gain estimé** : mémoire pic divisée par 2 pour les gros documents.

**Testabilité** :
- Vérifier que le stream produit le même contenu que `generate()`
- Vérifier que le backpressure est respecté
- Benchmark mémoire avec `process.memoryUsage()`

> **Note** : Cette optimisation est **bloquée** par le two-pass rendering (on ne peut pas streamer si on doit d'abord compter les pages). Implémenter [l'optimisation 1](#1-éliminer-le-double-rendu-two-pass) d'abord.

---

## 5. Pool d'objets pour les cellules de tableau

### Problème

Chaque cellule de tableau crée un **objet riche** (13 propriétés) avec des sous-objets :

```js
data[col] = {
  text, style: cellStyle, padding, fontSize, fontFamily,
  height: cellHeight, colspan, rowspan, nestedTables,
  nonTableChildren, rawCell, startRow, startCol,
};
```

Pour un tableau de 100×10, cela crée **1000 objets** par passe, soit **2000** avec le two-pass.

### Solution — Pré-allouer et réutiliser

```js
class CellData {
  constructor() {
    this.text = '';
    this.style = null;
    this.padding = 0;
    this.fontSize = 0;
    this.fontFamily = '';
    this.height = 0;
    this.colspan = 1;
    this.rowspan = 1;
    this.nestedTables = [];
    this.nonTableChildren = [];
    this.rawCell = null;
    this.startRow = 0;
    this.startCol = 0;
  }

  reset() {
    this.text = '';
    this.nestedTables.length = 0;
    this.nonTableChildren.length = 0;
    this.rawCell = null;
    return this;
  }
}

class CellPool {
  constructor(initialSize = 64) {
    this.pool = Array.from({ length: initialSize }, () => new CellData());
    this.index = 0;
  }

  acquire() {
    if (this.index < this.pool.length) {
      return this.pool[this.index++].reset();
    }
    const cell = new CellData();
    this.pool.push(cell);
    this.index++;
    return cell;
  }

  releaseAll() {
    this.index = 0;
  }
}
```

**Gain estimé** : ~10-15% sur les documents avec de grands tableaux (réduit la pression GC).

**Testabilité** :
- Vérifier que `acquire()` retourne des objets distincts
- Vérifier que `releaseAll()` permet de réutiliser les objets
- Vérifier que le pool grandit automatiquement
- Benchmark GC avec `--expose-gc`

---

## 6. Lazy loading des images

### Problème

Les images sont chargées dès que `renderImage()` est appelé, même si l'image sera sur une page ultérieure. Pendant la passe 1 (countPages), les images sont **chargées puis jetées** — gaspillage pur.

### Solution — Cache d'images partagé entre les passes

```js
class ImageCache {
  constructor() {
    this.cache = new Map();  // src → { buffer, width, height }
    this.pending = new Map(); // src → Promise (déduplique les chargements concurrents)
  }

  async load(src) {
    if (this.cache.has(src)) return this.cache.get(src);

    // Déduplique : si un chargement est déjà en cours pour cette src, attendre
    if (this.pending.has(src)) return this.pending.get(src);

    const promise = this._doLoad(src);
    this.pending.set(src, promise);

    try {
      const result = await promise;
      this.cache.set(src, result);
      return result;
    } finally {
      this.pending.delete(src);
    }
  }

  async _doLoad(src) {
    const buffer = await loadImage(src);
    return { buffer, src };
  }

  clear() {
    this.cache.clear();
    this.pending.clear();
  }
}
```

**Avantage supplémentaire** : déduplique les chargements si la même image apparaît plusieurs fois dans le document.

**Gain estimé** : ~20-30% sur les documents avec images (élimine le double chargement de la passe 1).

**Testabilité** :
- Vérifier que la même image n'est chargée qu'une fois
- Vérifier la déduplication des chargements concurrents
- Vérifier que `clear()` libère la mémoire
- Mocker `fetch` et vérifier le nombre d'appels

---

## 7. Compilation unique des regex CSS

### Problème

Dans `cssParser.js`, certaines regex sont **recréées à chaque appel** :

```js
// parsePageRule — ligne 236 : regex recréée dans une boucle
for (const zone of PAGE_ZONES) {
  const zoneRegex = new RegExp(`${zone}\\s*\\{([^}]*)\\}`, 'i');  // Création à chaque itération
  // ...
}

// parseFontFaces — ligne 55
const regex = /@font-face\s*\{([^}]*)\}/g;  // Recréée à chaque appel
```

### Solution — Regex pré-compilées au niveau module

```js
// Compilées UNE SEULE FOIS au chargement du module
const FONT_FACE_REGEX = /@font-face\s*\{([^}]*)\}/g;
const RULE_REGEX = /([^{}]+)\{([^}]*)\}/g;

const PAGE_ZONE_REGEXES = Object.freeze(
  PAGE_ZONES.reduce((acc, zone) => {
    acc[zone] = new RegExp(`${zone}\\s*\\{([^}]*)\\}`, 'i');
    return acc;
  }, {})
);

function parseFontFaces(css) {
  FONT_FACE_REGEX.lastIndex = 0; // Reset pour les regex avec flag /g
  // ...
}
```

**Gain estimé** : ~3-5% sur le parsing CSS (micro, mais gratuit).

**Testabilité** : Les tests existants valident le comportement — cette optimisation est un refactoring interne pur.

---

## 8. Réduire les traversées DOM

### Problème

Le DOM Cheerio est traversé **de multiples façons redondantes** :

1. `applyCssToElements` : traverse tout le DOM pour chaque règle CSS
2. `renderHtmlToPdf` : re-traverse `body.children().toArray()` (crée un nouveau tableau)
3. `countPages` : idem, re-parse et re-traverse

### Solution A — Application CSS par traversée unique

Au lieu de `$(selector)` pour chaque règle (N sélecteurs × M éléments), parcourir le DOM une seule fois et vérifier tous les sélecteurs pour chaque élément :

```js
function applyCssToElementsSinglePass($, css) {
  const rules = parseCssRules(css);
  if (rules.length === 0) return;

  // Une seule traversée de tous les éléments
  $('*').each((_index, element) => {
    if (element.type !== 'tag') return;

    let newStyles = '';
    for (const rule of rules) {
      if (elementMatchesSelector(element, rule.selector)) {
        newStyles += Object.entries(rule.properties)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ') + '; ';
      }
    }

    if (newStyles) {
      const existing = element.attribs.style || '';
      element.attribs.style = existing ? newStyles + existing : newStyles;
    }
  });
}
```

**Complexité** : passe de O(R × N) à O(N × R) — même complexité théorique, mais **1 traversée DOM** au lieu de R, ce qui est bien meilleur pour le cache CPU et les allocations.

### Solution B — Partager le DOM entre les passes

```js
// Parser une seule fois
const $ = cheerio.load(html);
if (options.css) applyCssToElements($, options.css);
const body = $('body').length > 0 ? $('body') : $(html);

// Passer le DOM pré-parsé aux deux passes
const totalPages = await countPages(body, options);  // body au lieu de html
// ... rendu final avec le même body
```

**Gain estimé** : ~10-15% (élimine un `cheerio.load` + `applyCssToElements` complet).

**Testabilité** : Vérifier que le résultat est identique avec un seul parsing.

---

## 9. Éviter les allocations dans les boucles chaudes

### Problème

Plusieurs patterns créent des objets temporaires à chaque itération :

```js
// Pattern 1 — Spread dans renderElement (appelé pour CHAQUE nœud)
const style = {
  ...parentStyle,                    // Crée un nouvel objet
  fontSize: inlineStyle.fontSize ?? FONT_SIZES[tagName] ?? parentStyle.fontSize,
  ...inlineStyle,                    // Re-crée un nouvel objet
};

// Pattern 2 — Options dans addPage (appelé à chaque saut de page)
doc.addPage({ ...opts, margin: 0 }); // Nouvel objet à chaque page

// Pattern 3 — split/map/join dans getCellText (appelé pour chaque cellule)
element.children
  .map(c => { ... })    // Nouveau tableau
  .join('')              // Nouvelle string
  .trim();               // Nouvelle string
```

### Solutions

**9a — Style mutable avec héritage prototypique** :

```js
function createChildStyle(parentStyle, inlineStyle, tagName) {
  const style = Object.create(parentStyle); // Pas de copie, juste un lien prototype
  if (inlineStyle.fontSize != null) style.fontSize = inlineStyle.fontSize;
  else if (FONT_SIZES[tagName]) style.fontSize = FONT_SIZES[tagName];
  // Copier uniquement les propriétés définies
  for (const key in inlineStyle) {
    if (inlineStyle[key] != null) style[key] = inlineStyle[key];
  }
  return style;
}
```

**Avantage** : `Object.create()` est ~10× plus rapide qu'un spread sur un objet de 6+ propriétés.

**9b — Objet de page réutilisable** :

```js
// Pré-alloué une fois
const pageOpts = { size: 'A4', layout: 'portrait', margin: 0 };

doc.addPage = function(opts = {}) {
  pageOpts.size = opts.size || 'A4';
  pageOpts.layout = opts.layout || 'portrait';
  originalAddPage(pageOpts);
};
```

**9c — getCellText sans allocation** :

```js
function getCellText(element) {
  let result = '';
  for (let i = 0; i < element.children.length; i++) {
    const c = element.children[i];
    if (c.type === 'text') {
      result += c.data;
    } else if (c.type === 'tag' && c.name !== 'table') {
      for (let j = 0; j < c.children.length; j++) {
        if (c.children[j].type === 'text') result += c.children[j].data;
      }
    }
  }
  return result.trim();
}
```

**Gain estimé** : ~10% global (cumulé sur des milliers d'appels).

**Testabilité** : Tests unitaires existants — refactoring interne pur.

---

## 10. Cache de mesure de texte

### Problème

`measureTextHeight()` est un appel **coûteux** à pdfkit (`heightOfString`), et il est fréquemment appelé avec les **mêmes paramètres** :

- Dans `renderText` : mesure avant de rendre
- Dans `renderTable` : mesure pour calculer la hauteur de chaque cellule
- Pendant la passe 1 : les mêmes mesures sont refaites en passe 2

### Solution — LRU cache léger

```js
class TextMeasureCache {
  constructor(maxSize = 512) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  key(text, fontFamily, fontSize, maxWidth) {
    return `${fontFamily}|${fontSize}|${maxWidth}|${text.length > 64 ? text.substring(0, 64) : text}`;
  }

  get(text, fontFamily, fontSize, maxWidth) {
    return this.cache.get(this.key(text, fontFamily, fontSize, maxWidth));
  }

  set(text, fontFamily, fontSize, maxWidth, height) {
    if (this.cache.size >= this.maxSize) {
      // Supprimer la plus ancienne entrée (Map conserve l'ordre d'insertion)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(this.key(text, fontFamily, fontSize, maxWidth), height);
  }
}
```

**Gain estimé** : ~15-25% sur les documents avec beaucoup de texte répétitif ou avec le two-pass.

**Testabilité** :
- Vérifier les hit/miss du cache
- Vérifier l'éviction LRU
- Vérifier que les mesures cachées sont identiques aux mesures directes
- Benchmark avec compteur de hits

---

## 11. Architecture modulaire pour le tree-shaking

### Problème actuel

`htmlRenderer.js` fait **1048 lignes** dans un seul fichier. Impossible de tree-shaker ou de charger partiellement.

### Solution — Découpage en sous-modules

```
src/
├── index.js
├── pdfGenerator.js
├── css/
│   ├── parser.js          # parseCssRules, elementMatchesSelector
│   ├── applier.js         # applyCssToElements
│   ├── pageRule.js        # parsePageRule, PAGE_ZONES
│   └── fontFace.js        # parseFontFaces, stripFontFaceBlocks
├── render/
│   ├── context.js         # PageLayout, style management
│   ├── text.js            # renderText, measureTextHeight
│   ├── table.js           # renderTable, CellPool
│   ├── list.js            # renderList
│   ├── image.js           # renderImage, loadImage, ImageCache
│   ├── element.js         # renderElement (dispatch)
│   └── headerFooter.js    # renderPageZone, renderHeaderFooterContent
├── cache/
│   ├── textMeasure.js     # TextMeasureCache
│   ├── imageCache.js      # ImageCache
│   └── styleCache.js      # WeakMap style cache
└── utils/
    └── fonts.js           # registerFontFaces, resolveFontFamily
```

**Avantages** :
- Chaque module est **testable indépendamment**
- Évolutif : ajouter `render/blockquote.js` sans toucher aux autres
- Tree-shakable : un consommateur qui n'utilise pas les tableaux ne charge pas `render/table.js`
- Facilite le travail collaboratif (moins de conflits de merge)

**Testabilité** : Chaque module exporte des fonctions pures ou des classes instanciables, testables unitairement.

---

## 12. Mode « fast » sans compteurs de page

### Innovation — API à deux vitesses

La majorité des utilisateurs n'utilisent pas `counter(num-pages)`. Proposer un mode explicite :

```js
const generator = createPdfGenerator({
  mode: 'fast', // Par défaut — une seule passe, pas de counter(num-pages)
});

// Ou pour les cas avancés
const generator = createPdfGenerator({
  mode: 'full', // Deux passes, counter(num-pages) supporté
});
```

En mode `fast` :
- **1 seule passe** de rendu
- `counter(page)` fonctionne (incrémenté à chaque `addPage`)
- `counter(num-pages)` affiche `?` ou est ignoré
- **50% plus rapide** que le mode `full`

**Testabilité** : Tester les deux modes séparément, vérifier que `fast` est strictement plus rapide.

---

## 13. Résumé et priorisation

| # | Optimisation | Gain estimé | Effort | Risque | Priorité |
|---|---|---|---|---|---|
| 1C | Conditional two-pass | ~50% temps | Faible | Nul | 🔴 Critique |
| 2 | Cache styles inline (WeakMap) | ~15-20% | Faible | Nul | 🔴 Critique |
| 8B | Partager le DOM entre passes | ~10-15% | Faible | Faible | 🔴 Critique |
| 6 | Cache d'images partagé | ~20-30% | Moyen | Nul | 🟠 Haute |
| 10 | Cache mesure de texte | ~15-25% | Moyen | Faible | 🟠 Haute |
| 9 | Réduire les allocations | ~10% | Moyen | Faible | 🟠 Haute |
| 3 | PageLayout pré-calculé | ~5% | Faible | Nul | 🟡 Moyenne |
| 7 | Regex pré-compilées | ~3-5% | Faible | Nul | 🟡 Moyenne |
| 12 | Mode fast | ~50% | Moyen | Nul | 🟡 Moyenne |
| 5 | Pool de cellules | ~10-15% | Moyen | Moyen | 🟡 Moyenne |
| 4 | Streaming PDF | -50% mémoire | Moyen | Moyen | 🔵 Basse |
| 11 | Refactoring modulaire | 0% direct | Élevé | Faible | 🔵 Basse |
| 1A | Post-remplacement PDF | ~50% temps | Élevé | Élevé | 🔵 Basse |
| 8A | CSS single-pass | ~5-10% | Moyen | Moyen | 🔵 Basse |

### Ordre d'implémentation recommandé

```
Phase 1 — Quick wins (gains immédiats, risque nul)
  ├── 1C. Conditional two-pass
  ├── 2.  Cache styles inline
  ├── 3.  PageLayout pré-calculé
  └── 7.  Regex pré-compilées

Phase 2 — Caches partagés (gains majeurs)
  ├── 8B. Partager le DOM
  ├── 6.  Cache d'images
  └── 10. Cache mesure de texte

Phase 3 — Micro-optimisations et API
  ├── 9.  Réduire les allocations
  ├── 12. Mode fast
  └── 5.  Pool de cellules

Phase 4 — Architecture long terme
  ├── 11. Refactoring modulaire
  ├── 4.  Streaming PDF
  └── 1A. Post-remplacement PDF
```

### Comment valider les gains

Créer un fichier `bench/benchmark.js` :

```js
import { createPdfGenerator } from '../src/index.js';
import { performance } from 'perf_hooks';

const generator = createPdfGenerator();

const cases = {
  'texte simple': '<p>Hello</p>'.repeat(100),
  'tableau 50x10': generateTable(50, 10),
  'images': generateImages(20),
  'document complet': generateFullDocument(),
};

for (const [name, html] of Object.entries(cases)) {
  const start = performance.now();
  const memBefore = process.memoryUsage().heapUsed;

  await generator.generate(html);

  const elapsed = performance.now() - start;
  const memAfter = process.memoryUsage().heapUsed;

  console.log(`${name}: ${elapsed.toFixed(1)}ms | +${((memAfter - memBefore) / 1024 / 1024).toFixed(1)}MB`);
}
```

> Exécuter ce benchmark **avant et après** chaque optimisation pour mesurer objectivement les gains.
