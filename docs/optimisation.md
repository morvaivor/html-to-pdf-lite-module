# Guide & Architecture d'Optimisation — `html-to-pdf-lite-module`

> **Philosophie d'ingénierie** : Maintenir un moteur de génération PDF ultra-léger, sans dépendances lourdes (sans Chromium/Puppeteer), hautement concurrentiel et préservant l'Event Loop de Node.js avec une consommation mémoire rigoureusement bornée.

---

## 🎯 Règle d'Or et Critères d'Acceptation

Toute optimisation appliquée au projet respecte la règle directrice :

> **Optimiser le travail répété en priorité, les allocations mémoire en second, et les micro-opérations en dernier.**

### Critères de Validation Stricts :
1. **Exactitude Sémantique** : Aucune altération du rendu visuel des documents PDF par rapport au moteur de référence.
2. **Mesurabilité Expérimentale** : Chaque gain doit être validé avant/après via le banc de microbenchmarks et sous charge concurrente.
3. **Mémoire Bornée** : Aucun cache ni file d'attente ne peut croître sans limite ($O(1)$ LRU et bounded backpressure).
4. **Zéro Régression d'API** : Compatibilité publique totale avec les options existantes.

---

## 🏗️ Architecture Détaillée des Optimisations (Patches 01 à 12)

### 🔹 Patch 01 — Correction et Montée en Gamme de `TextMeasureCache`
- **Problème initial** : La clé de cache n'incluait que la longueur du texte et un préfixe court, provoquant des collisions géométriques sur des textes distincts de même longueur. De plus, les hits ne rafraîchissaient pas les entrées (éviction de type FIFO au lieu de LRU).
- **Architecture implémentée** ([`src/core/cacheManager.ts`](../src/core/cacheManager.ts)) :
  - Clé composite stricte : `${fontFamily}|${fontSize}|${maxWidth}|${lineGap}|${text}`.
  - Rafraîchissement LRU immédiat lors de chaque hit (`delete` puis `set`).
  - Capacité maximale bornée à 5 000 entrées pour plafonner l'empreinte mémoire.

---

### 🔹 Patch 02 — Cache LRU Générique Réutilisable (`LruCache<K, V>`)
- **Problème initial** : Plusieurs caches utilisaient `if (cache.size >= MAX) cache.clear();`, provoquant des purges destructives répétées (*cache thrashing*) et des chutes brutales de débit.
- **Architecture implémentée** ([`src/core/lruCache.ts`](../src/core/lruCache.ts)) :
  - Structure de données $O(1)$ basée sur une double liste chaînée (`head` / `tail`) couplée à une `Map` JavaScript.
  - API standard : `get(key)`, `set(key, value)`, `has(key)`, `delete(key)`, `clear()`.
  - Déployé pour :
    - `TextMeasureCache` (mesure vectorielle de texte).
    - Cache des styles en ligne parsés (`parseInlineStyle`).
    - Cache des déclarations CSS (`parseCssDeclarations`).
    - Cache des règles globales de pages `@page`.

---

### 🔹 Patch 03 — Indexation Hiérarchique des Sélecteurs CSS
- **Problème initial** : Les règles CSS étaient appliquées en scannant tout le DOM avec Cheerio pour chaque règle ($O(\text{règles} \times \text{nœuds})$), devenant le goulot d'étranglement majeur sur les grandes feuilles de style.
- **Architecture implémentée** ([`src/cssParser.ts`](../src/cssParser.ts)) :
  ```text
  Feuille de style CSS
         ↓
  Classification des sélecteurs
         ↓
  Index Structuré (CssRuleIndex)
     ├── byId      : Map<id, CssRule[]>
     ├── byClass   : Map<class, CssRule[]>
     ├── byTag     : Map<tagName, CssRule[]>
     └── complex   : CssRule[] (descendants, combinés)
  ```
  - **Chemin rapide (Fast-Path)** : Résolution en une seule passe DOM ($O(\text{nœuds})$) pour `#id`, `.class`, `tag`, `tag.class`, `tag#id`.
  - **Préservation sémantique** : Respect strict du calcul de spécificité `(id, class, tag)`, de l'ordre d'apparition source et des directives `!important`.

---

### 🔹 Patch 04 — Cache d'Actifs Inter-PDF (`AssetCache`) & Request Coalescing
- **Problème initial** : Les polices distantes et images étaient chargées au niveau du scope de chaque PDF unitaire, provoquant des téléchargements HTTP répétés pour un même logo ou une même police.
- **Architecture implémentée** ([`src/core/assetCache.ts`](../src/core/assetCache.ts), [`src/core/fontManager.ts`](../src/core/fontManager.ts)) :
  - Cache d'actifs partagé en mémoire vive à travers toutes les générations de documents.
  - **Déduplication des requêtes en vol (*In-Flight Request Coalescing*)** :
    ```text
    Requête A ──┐
    Requête B ──┼──→ Même URL distante
    Requête C ──┘         ↓
                     1 seul fetch HTTP
    ```
  - Suivi des Promesses en vol via `inFlightLoads: Map<string, Promise<Buffer>>`.
  - Capacité bornée (`maxImages: 100`, `maxFonts: 50`) avec nettoyage automatique en cas de rejet réseau.

---

### 🔹 Patch 05 — Sommes Préfixes de Tableaux en $O(1)$
- **Problème initial** : Le calcul des coordonnées $X$ et des largeurs de cellules utilisait des ré-évaluations répétées `.slice().reduce()`, générant des tableaux intermédiaires et un surcoût quadratique sur les grandes tables.
- **Architecture implémentée** ([`src/renderers/tableRenderer.ts`](../src/renderers/tableRenderer.ts)) :
  - Précalcul des coordonnées cumulées en début de rendu :
    $$\text{columnX}[i + 1] = \text{columnX}[i] + \text{colWidths}[i]$$
    $$\text{rowPrefix}[r + 1] = \text{rowPrefix}[r] + \text{rowHeights}[r]$$
  - Calcul direct en $O(1)$ sans allocation :
    $$X = \text{columnX}[\text{startCol}]$$
    $$\text{Width} = \text{columnX}[\text{startCol} + \text{colspan}] - \text{columnX}[\text{startCol}]$$
  - Rendu fluide de tableaux de 1 000 lignes × 10 colonnes (10 000 cellules) sans dégradation exponentielle.

---

### 🔹 Patch 06 — Mémoïsation du Layout (`estimateElementHeight`)
- **Problème initial** : Les passes de disposition Flexbox et Grid évaluent la hauteur des enfants pour aligner les conteneurs, puis ré-estiment ces mêmes enfants lors du rendu réel.
- **Architecture implémentée** ([`src/renderers/registry.ts`](../src/renderers/registry.ts)) :
  - Mémoïsation au scope du document via `LayoutMeasurementCache` (`WeakMap<Element, Map<string, number>>`).
  - Clé de contexte intégrant la largeur disponible et les styles typographiques pour éviter toute mesure obsolète.

---

### 🔹 Patch 07 — Indexation Directe des Variantes Typographiques
- **Problème initial** : La résolution des variantes d'une police scannait linéairement un `Set` d'alias pour chaque bloc de texte.
- **Architecture implémentée** ([`src/core/fontManager.ts`](../src/core/fontManager.ts)) :
  - Indexation directe normalisée : `_aliasDirectIndex` associant une clé `family|bold|italic` directement au nom interne PDFKit.
  - Résolution $O(1)$ immédiate pour tous les blocs de texte standard.

---

### 🔹 Patch 08 — Régulation de File (Bounded Backpressure)
- **Problème initial** : La file d'attente du pool de workers était infinie. En cas d'afflux massif de requêtes, la mémoire vive augmentait sans limite jusqu'au crash processus (*Out of Memory*).
- **Architecture implémentée** ([`src/workers/workerPool.ts`](../src/workers/workerPool.ts)) :
  - Option `maxQueueSize` (défaut : `maxWorkers * 2`).
  - Rejet immédiat de l'excédent avec l'erreur typée `WorkerPoolBusyError`.
  - Mappable directement en code HTTP `429 Too Many Requests` ou `503 Service Unavailable` dans une API de production.

---

### 🔹 Patch 09 — Plancher de Threads Chauds (`minWorkers`)
- **Problème initial** : Le démarrage du pool depuis zéro thread créait une latence de démarrage à froid (*cold start*) de 20 à 50 ms sur les premières requêtes.
- **Architecture implémentée** ([`src/workers/workerPool.ts`](../src/workers/workerPool.ts)) :
  - Option `minWorkers?: number` pré-démarrant un plancher de worker threads maintenus chauds en RAM.
  - Les workers excédentaires s'éteignent automatiquement après inactivité (`idleTimeoutMs: 10000`), sans jamais descendre sous le plancher `minWorkers`.

---

### 🔹 Patch 10 — Sondes de Profilage sans Surcoût
- **Problème initial** : Impossibilité d'isoler quelle phase du pipeline consommait le temps CPU lors des analyses de charge.
- **Architecture implémentée** ([`src/htmlRenderer.ts`](../src/htmlRenderer.ts), [`src/types.ts`](../src/types.ts)) :
  - Décomposition en 5 sous-systèmes chronométrés :
    1. DOM Parsing (Cheerio)
    2. CSS Parsing & Indexation
    3. Enregistrement Polices
    4. Layout & Rendu d'Éléments
    5. Assemblage Binaire PDFKit
  - Activables sans overhead via `debug: true`, `verbose: true`, ou programmatique `profiling: true` avec callback `onProfile(timings)`.

---

### 🔹 Patch 11 — Matrice de Benchmark Étendue
- **Réalisation** ([`bench/benchmark.ts`](../bench/benchmark.ts)) :
  - Fixtures synthétiques calibrées : CSS Scaling (100 à 500 règles / 1k à 5k nœuds), Typographie (1 000 répétées vs 1 000 uniques), Tableaux (100×5 à 1 000×10), Layout profond (Flex, Grid 3×3).
  - Matrices de concurrence multi-thread : 1, 2, 4, 8, 16 requêtes simultanées avec latences p50, p95, p99 et métriques RSS.

---

### 🔹 Patch 12 — Documentation Automatisée des Performances
- **Réalisation** ([`bench/benchmark.ts`](../bench/benchmark.ts), [`docs/benchmark.md`](benchmark.md)) :
  - Génération automatique du rapport Markdown avec horodatage, révision git, version exacte de Node.js, processeur hôte et nombre de threads alloués.

---

## 🧬 Couche d'Accélération Exacte & Innovations Mémoire / CPU (Patches 13 à 21)

Le profilage CPU montre que 80 à 95 % du temps de génération se passe dans la phase *layout*, et que cette phase est dominée non par le code de mise en page du module mais par la **mécanique de polices standard (AFM) de PDFKit**, qui travaille sur des *noms* de glyphes : `getKernPair` (concaténation `gauche\0droite` + lookup en mode dictionnaire) représentait à lui seul 9 à 13 % du temps total. Les patches 13 à 21 ciblent ces coûts avec une contrainte stricte : **aucun octet du PDF ne change**, sauf pour la déduplication d'images (patch 20), dont le rendu est identique au pixel près.

### 🔬 Méthode de Vérification de l'Exactitude
1. **Empreinte octet par octet** : SHA-256 des PDF de 23 scénarios (11 templates de `demo/templates` + 12 synthétiques : CSS 500 règles/5k nœuds, 1 000 paragraphes, table 1000×10, boîtes imbriquées, zones `@page`, en-têtes/pieds…), date figée, avant/après chaque patch.
2. **Empreinte canonique** (objets décompressés, références normalisées, triés) pour le seul cas non déterministe préexistant : les PNG avec canal alpha, que PDFKit décode de façon asynchrone.
3. **Rastérisation pixel par pixel** (`pdftoppm`, 72, 110 et 150 DPI) pour les optimisations qui modifient le nombre d'objets.
4. **Test automatisé** ([`test/performanceInnovations.test.ts`](../test/performanceInnovations.test.ts)) : rend un jeu d'échantillons (typographie Unicode et crénage, tables CSS avec `colspan`/`rowspan`, police embarquée, zones `@page`, en-têtes, SVG, couleurs) dans le processus accéléré puis dans un **sous-processus `PDF_LITE_ACCEL=off` (PDFKit d'origine)**, et exige des PDF identiques. Des tests différentiels confrontent aussi le nouveau LRU et la nouvelle application CSS à leurs implémentations de référence.

### 🛡️ Modèle de Sûreté ([`src/core/pdfkitAccelerator.ts`](../src/core/pdfkitAccelerator.ts))
- **Garde par empreinte de code source** : chaque remplacement n'est installé que si le SHA-256 du code PDFKit remplacé (classes `AFMFont`, `StandardFont`, `PDFReference`, méthodes `font`, `_setColorCore`, `_normalizeColor`) correspond à l'implémentation auditée (0.20.x). Sinon, le code d'origine est conservé et `ensurePdfKitAccelerator().reason` l'explique.
- **Auto-test** : les tables compilées d'une police sont comparées aux méthodes d'origine de PDFKit (256 codes WinAnsi, caractères typographiques, paires crénées) avant toute utilisation.
- **Interrupteur** : `PDF_LITE_ACCEL=off` restaure le comportement d'origine.

---

### 🔹 Patch 13 — Flyweight des Métriques de Polices Standard
- **Problème initial** : 65 % du coût de `new PDFDocument()` (~0,5 ms) venait du constructeur `AFMFont`, qui redécode ~1 220 paires de crénage (Helvetica) en clés chaîne **pour chaque document et chaque police standard utilisée**.
- **Architecture implémentée** : les métriques sont décodées **une fois par processus (ou worker)** et partagées par tous les documents. Les données brutes du module de police ne sont masquées que le temps de la construction synchrone de l'instance par document, aussitôt remplacée par l'instance partagée complète : aucun code tiers ne peut observer l'état intermédiaire.

### 🔹 Patch 14 — Métriques Compilées & Positions de Glyphes Internées
- **Problème initial** : ~180 ns/caractère pour mesurer et ~120 ns/caractère pour encoder (5 objets alloués par glyphe), avec deux passes de césure par paragraphe (mesure puis rendu).
- **Architecture implémentée** :
  - Chasses en `Float64Array` et matrice de crénage compacte en `Int16Array` (≤ 86 × 95 entrées, ~16 Ko par police), indexées par code de caractère.
  - Objets de position **internés et gelés** (`Object.freeze`) : encoder une ligne alloue 2 tableaux au lieu de 5 objets par glyphe.
  - Accumulation dans le même ordre que PDFKit : flottants identiques au bit près.

### 🔹 Patch 15 — Cache des Opérandes de Couleur
- **Problème initial** : chaque `fillColor('#rrggbb')` reparsait l'hexadécimal et reformatait trois flottants.
- **Architecture implémentée** : les couleurs hexadécimales et nommées étant résolues avant les couleurs d'accompagnement propres à chaque document, leurs opérandes (`0.2 0.254902 0.333333`) sont internés à l'échelle du processus (≤ 1 024 entrées).

### 🔹 Patch 16 — Coalescence des Flux de Contenu
- **Problème initial** : chaque opérateur (`BT`, `Tf`, `TJ`…) était converti en `Uint8Array` par une boucle caractère par caractère, puis reconcaténé : des milliers de micro-allocations par page.
- **Architecture implémentée** : les opérateurs restent des chaînes jusqu'à la finalisation du flux, encodé en **un seul** `Buffer.from(…, 'latin1')`, dont l'équivalence avec le `& 0xff` de PDFKit est vérifiée sur les 65 536 unités UTF-16.

### 🔹 Patch 17 — LRU Intrusif à Liste Doublement Chaînée
- **Problème initial** : chaque hit du `LruCache` faisait `delete` + `set` sur la `Map` (trous dans la table de hachage de V8, réallocations périodiques).
- **Architecture implémentée** ([`src/core/lruCache.ts`](../src/core/lruCache.ts)) : `Map` → nœuds chaînés, promotion par relinkage $O(1)$, **recyclage du nœud évincé** (zéro allocation en régime plein). Hits 2,8× plus rapides (54 → 19 ns), usage mixte 1,7×, sémantique LRU exacte (test différentiel sur 20 000 opérations aléatoires).

### 🔹 Patch 18 — Partage des Styles Calculés (*Style Sharing*)
- **Problème initial** : chaque élément, et chaque cellule de tableau, allouait par *spread* un objet de ~45 propriétés, deux fois (mesure puis rendu).
- **Architecture implémentée** ([`src/renderers/registry.ts`](../src/renderers/registry.ts), [`src/renderers/tableRenderer.ts`](../src/renderers/tableRenderer.ts)) : technique des moteurs de navigateurs. Un style calculé étant une fonction pure du style parent, du style inline parsé et de la balise, il est mémoïsé par identité dans des `WeakMap` imbriquées, libérées avec le document. Les éléments sans style partagent un objet vide gelé (`EMPTY_INLINE_STYLE`).

### 🔹 Patch 19 — Application CSS en une Seule Passe
- **Problème initial** : ~11 parcours complets du DOM par le moteur de sélecteurs (`[style]`, `*`, `[data-orig-style]`, `link` et `style` deux fois chacun, `body` deux fois), plus une longue chaîne de style reconstruite puis rehachée pour chaque élément.
- **Architecture implémentée** ([`src/cssParser.ts`](../src/cssParser.ts), [`src/htmlRenderer.ts`](../src/htmlRenderer.ts)) :
  - Un parcours itératif unique, dans l'ordre exact de `$('*')`.
  - Index des règles compilé **une fois par feuille de style** et réutilisé entre documents.
  - Chaînes de style finales **internées par combinaison** (règles appliquées + style inline), cache de parsing **pré-amorcé**.
  - Requêtes `link`/`style` sautées lorsque la balise est absente du source ; attribut transitoire `data-orig-style` matérialisé seulement si un sélecteur peut l'observer.

### 🔹 Patch 20 — Déduplication des Images par Document
- **Problème initial** : PDFKit ne réutilise que les images ouvertes depuis un chemin ; une image `Buffer` était redécodée, recompressée et réintégrée **pour chaque `<img>`**.
- **Architecture implémentée** ([`src/renderers/imageRenderer.ts`](../src/renderers/imageRenderer.ts)) : images ouvertes mémoïsées par document et par `Buffer`, soit un XObject par source. Un document de 20 pages aux logos répétés passe de **518 Ko à 28 Ko**, `images-100` de 45 Ko à 2 Ko (−88 à −93 % de CPU), rendu identique au pixel près.

### 🔹 Patch 21 — Buffering Adaptatif des Pages
- **Problème initial** : `bufferPages: true` gardait toutes les pages en mémoire jusqu'à la fin, même sans en-tête ni pied de page.
- **Architecture implémentée** : le buffering n'est activé que si des zones `@page`, un `header` ou un `footer` exigent le nombre total de pages. Sinon, chaque page est compressée et libérée dès que la suivante commence, soit $O(1)$ pages en mémoire. PDFKit écrivant les objets dans le même ordre, la sortie reste identique à l'octet.

### 📈 Résultats Mesurés (Patches 13 à 21)
- **Méthodologie** : A/B/C **entrelacé** (chaque variante dans son propre processus, ordre alterné à chaque tour), processus épinglé sur un cœur P (`taskset`), **temps CPU** (`process.cpuUsage`, threads GC inclus) et **octets alloués** (`v8.GCProfiler`). Intel i7-13800H, Node.js v24.20, machine chargée (charge moyenne 4 à 6). Les chiffres par scénario sont la médiane de 4 sessions indépendantes.
- **Global (23 scénarios)** : **−36 à −40 % de CPU**, **−42 à −46 % de temps réel**, **−44,5 % d'allocations** (1 110 → 615 Mo).
- **Pic de mémoire vivante** : table 1000×10 **52,5 → 14,5 Mo (−72 %)**, CSS 500 règles **19,7 → 9,7 Mo (−51 %)**, grand livre financier **26,7 → 13,2 Mo (−51 %)**.

| Scénario | Temps (médiane) | Allocations |
|---|:---:|:---:|
| Rapport Éditorial (template) | **−80 %** | −64 % |
| Menu Restaurant (template) | **−59 %** | −54 % |
| Contrat Juridique (template) | **−58 %** | −53 % |
| Rapport Médical (template) | **−40 %** | −36 % |
| Facture Professionnelle (template) | **−32 %** | −44 % |
| Grand Livre Financier, 18 pages (template) | **−20 %** | −41 % |
| 1 000 paragraphes uniques | **−56 %** | −55 % |
| CSS 500 règles / 5 000 nœuds | **−47 %** | −48 % |
| Table 1 000 × 10 | **−33 %** | −32 % |
| En-têtes & pieds de page | **−60 %** | −51 % |

---

## ⚡ Accélération Native WebGPU (Compute Shaders WGSL)

Le module intègre un accélérateur WebGPU **100% standard W3C Headless**, sans aucune dépendance tierce npm (micro-interfaces TypeScript pures) :

```text
HTML → Cheerio → Layout CPU
                     │
          Table >= 4096 cellules ?
          ├── OUI ──► GPU Compute Shader (WGSL) ──► Résultat compact
          └── NON ──► CPU Fast-Path O(N)       ──► Résultat compact
                                                        │
                                                        ▼
                                                   Layout CPU
                                                        │
                                                        ▼
                                                     PDFKit
```

### Caractéristiques Techniques :
- **Shader WGSL** ([`src/gpu/shaders/tableRowReduce.wgsl.ts`](../src/gpu/shaders/tableRowReduce.wgsl.ts)) : Parallélisation massive de la réduction des hauteurs de lignes sur des workgroups de 64 threads SIMD.
- **Seuil d'amortissement (`GPU_TABLE_MIN_CELLS = 4096`)** : Empêche le surcoût de transfert mémoire PCIe sur les petits tableaux de factures, traités instantanément en ~2 µs par le CPU.
- **Pools de Buffers VRAM** : Réutilisation de tampons de stockage arrondis aux puissances de 2 pour éliminer les allocations répétées côté driver.
- **Fallback CPU Silencieux & Parité Stricte** : Si aucun adaptateur matériel n'est présent (ex: conteneurs headless Docker ou CI/CD), basculement transparent avec parité mathématique $\Delta \le 0.001$ pt.

---

## 📊 Synthèse des Mesures de Performance

Les résultats consolidés issus de l'exécution sur machine physique (AMD Ryzen 5 3600, 12 threads logiques, Node.js v24) :

### 1. Débits Unitaires Mono-Thread
| Document / Modèle | Latence Moyenne | Débit Mesuré | Taille PDF |
|---|:---:|:---:|:---:|
| **Certificat Paysage (A4)** | ~13.5 ms | **~73.9 docs / s** | 3.6 KB |
| **Facture Professionnelle (A4)** | ~20.4 ms | **~49.1 docs / s** | 4.1 KB |
| **Catalogue Produit (A4)** | ~22.0 ms | **~45.5 docs / s** | 5.9 KB |
| **Rapport Éditorial (A4)** | ~26.8 ms | **~37.3 docs / s** | 5.3 KB |
| **Dashboard Analytique (A4)** | ~28.2 ms | **~35.5 docs / s** | 7.2 KB |
| **Table Légère (100 lignes × 5 cols)** | ~25.5 ms | **~39.2 docs / s** | 7.5 KB |
| **Table Dense (1 000 lignes × 10 cols)** | ~389.8 ms | **~2.6 docs / s** | 106.0 KB |

### 2. Montée en Charge Multi-Thread (Worker Pool 9 Threads)
- **Documents Standards / Légers (1 passe)** : Débit atteignant **~797.6 documents / seconde** sous 16 requêtes simultanées (p50 : 12.6 ms).
- **Documents Complexes Entreprise (2 passes + zones de page)** : Débit stabilisé à **~147.2 documents / seconde** (p50 : 65.7 ms).

### 3. Test d'Endurance Massif (15 000 Documents — `npm run test:soak:parallel`)
- **Volume** : 15 000 documents avec tables d'entreprise et styles réalistes.
- **Durée** : **66.10 secondes** (Débit moyen : **226.9 docs / seconde**, soit 4.41 ms par document).
- **Mémoire Heap V8** : Stabilisée à **66.95 MB** du début à la fin (aucune fuite mémoire).
- **Télémétrie GPU** : 14 940 tables routées instantanément sur le fast-path CPU sans surcharge.

### 4. Banc d'Essai Extrême (80 000 Tables & PDFs Lourds — `npm run test:soak:80k`)
- **Calcul Brut (80 000 tables de 5 000 cellules = 400 000 000 de cellules)** :
  - Durée CPU : 708.28 ms (~8.85 µs / table)
  - Durée Accélérée : 623.15 ms (~7.79 µs / table)
  - Débit : **112 950 tables réduites / seconde** avec parité mathématique stricte ($\Delta \le 0.001$).
- **Génération Multi-Threads** : ~21.6 docs lourds / s (~108 000 cellules générées et rendues par seconde).

---

## 🛠️ Commandes pour Exécuter les Benchmarks

```bash
# 1. Matrice officielle complète (Mono-thread, Microbenchmarks, Profilage, Concurrence, WebGPU)
npm run benchmark

# 2. Test d'endurance séquentiel classique (200 documents)
npm run test:soak

# 3. Test d'endurance massif multi-thread (15 000 documents)
npm run test:soak:parallel

# 4. Banc d'essai extrême 80 000 tables et documents lourds (CPU vs WebGPU)
npm run test:soak:80k

# 5. Validation rapide du banc d'essai lourd (1 000 documents)
npm run test:soak:80k:quick
```
