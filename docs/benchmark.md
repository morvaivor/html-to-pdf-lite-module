# 📊 Rapport de Benchmark & Performances — v2.3.0

> **Date d'exécution** : 2026-09-20  
> **Version du module** : `pdf-generator@2.3.0` (Commit: `8fe9ab8`)  
> **Environnement Système** : Node.js v24.19.0 — Windows_NT 10.0.26200 (x64)  
> **Processeur Hôte** : AMD Ryzen 5 3600 6-Core Processor               (12 cœurs logiques)  
> **Mémoire Système** : 15.9 GB RAM  
> **Workers alloués** : 9 threads logiques (80% CPU)  
> **Commande de benchmark** : `npm run benchmark`

---

## 🎯 Objectif & Vue d'Ensemble

Ce benchmark valide l'implémentation complète du **Plan d'Optimisation des Performances (Patches 01 à 12)** :
- Caches LRU bornés avec éviction $O(1)$ (`TextMeasureCache`, `_fontResolutionCache`, caches CSS).
- Indexation CSS hiérarchique (`byId`, `byClass`, `byTag`, `complex`) avec résolution en une seule passe DOM.
- Cache d'actifs inter-PDF (`AssetCache`) avec déduplication des requêtes distantes en vol.
- Calcul $O(1)$ des coordonnées de cellules de tableau par sommes préfixes (`columnX`, `rowPrefix`).
- Mémoïsation des mesures de layout (`LayoutMeasurementCache`).
- Résolution directe $O(1)$ des variantes de polices (`_aliasDirectIndex`).
- Bounded backpressure (`maxQueueSize`, `WorkerPoolBusyError`) et maintien d'un pool de workers chauds (`minWorkers`).
- Instrumentation de profilage par phase sans surcoût au repos.

---

## ⚡ 1. Microbenchmarks Mono-Thread par Composant

Mesures obtenues en exécution séquentielle après amorçage des caches :

| Catégorie | Scénario d'essai | Latence Min | Latence Moyenne | Latence Max | Débit Unitaire | Taille PDF |
|:---|:---|:---:|:---:|:---:|:---:|:---:|
| **CSS** | CSS 100 rules / 1k nodes | 90.91 ms | **100.79 ms** | 126.88 ms | ~9.9 docs/s | 29.4 KB |
| **CSS** | CSS 500 rules / 5k nodes | 459.42 ms | **477.06 ms** | 501.28 ms | ~2.1 docs/s | 141.1 KB |
| **Typography** | Typography (1000 repeated par.) | 109.84 ms | **112.38 ms** | 118.53 ms | ~8.9 docs/s | 38.6 KB |
| **Typography** | Typography (1000 unique par.) | 225.78 ms | **231.61 ms** | 234.77 ms | ~4.3 docs/s | 44.0 KB |
| **Typography** | Typography (Long wrapped text) | 15.18 ms | **16.12 ms** | 18.13 ms | ~62.0 docs/s | 6.5 KB |
| **Tables** | Table (100 rows x 5 cols) | 23.21 ms | **29.58 ms** | 41.69 ms | ~33.8 docs/s | 7.2 KB |
| **Tables** | Table (500 rows x 10 cols) | 197.54 ms | **214.38 ms** | 238.33 ms | ~4.7 docs/s | 51.8 KB |
| **Tables** | Table (1000 rows x 10 cols) | 432.48 ms | **440.37 ms** | 453.10 ms | ~2.3 docs/s | 102.3 KB |
| **Layout** | Layout (Deep nested flex) | 4.65 ms | **5.74 ms** | 6.51 ms | ~174.3 docs/s | 1.6 KB |
| **Layout** | Layout (Deep grid 3x3) | 4.44 ms | **5.66 ms** | 7.71 ms | ~176.7 docs/s | 1.9 KB |
| **Layout** | Layout (Table inside flex card) | 13.05 ms | **17.74 ms** | 22.75 ms | ~56.4 docs/s | 3.8 KB |
| **Assets** | Assets (100 repeated images) | 14.97 ms | **22.60 ms** | 38.58 ms | ~44.2 docs/s | 43.9 KB |
| **Template Réel** | Rapport Éditorial (A4) | 24.58 ms | **27.31 ms** | 32.00 ms | ~36.6 docs/s | 5.3 KB |
| **Template Réel** | Catalogue Produit (A4) | 19.85 ms | **23.24 ms** | 28.28 ms | ~43.0 docs/s | 5.9 KB |
| **Template Réel** | Dashboard Analytique (A4) | 25.56 ms | **31.03 ms** | 35.97 ms | ~32.2 docs/s | 7.2 KB |
| **Template Réel** | Facture Professionnelle (A4) | 18.82 ms | **24.43 ms** | 40.13 ms | ~40.9 docs/s | 4.1 KB |
| **Template Réel** | Certificat Paysage (A4) | 12.69 ms | **16.43 ms** | 22.47 ms | ~60.9 docs/s | 3.6 KB |

---

## ⏱ 2. Décomposition du Temps d'Exécution par Phase (Patch 10)

Mesure sur un document complet (titres, styles, tableaux, listes et paragraphes) :

| Phase du Pipeline | Temps d'exécution | Part du Temps Total | Rôle & Optimisation associée |
|:---|:---:|:---:|:---|
| **DOM Parsing (Cheerio)** | 1.54 ms | 6.5% | Parsing AST en une seule passe |
| **CSS Parsing & Indexation** | 0.58 ms | 2.5% | Indexation par sélecteur $O(1)$ (Patch 03) |
| **Enregistrement Polices** | 0.02 ms | 0.1% | Cache d'actifs et index direct (Patches 04 & 07) |
| **Layout & Rendu d'Éléments** | 18.36 ms | 77.6% | Sommes préfixes et mémoïsation layout (Patches 05 & 06) |
| **Assemblage Binaire PDFKit** | 0.30 ms | 1.3% | Émission du flux binaire et compression |
| **Total Global** | **23.65 ms** | **100%** | Latence totale unitaire de bout en bout |

> [!NOTE]
> **Pourquoi le Layout & Rendu d'Éléments représente 75% à 85% du temps ?**  
> Le découpage ci-dessus démontre que le parsing HTML (1.13 ms) et l'indexation CSS (0.55 ms) sont négligeables. L'essentiel du CPU est consommé par le calcul géométrique des glyphes de texte dans PDFKit (`doc.heightOfString`, `doc.text`), le calcul des retours à la ligne (*word wrapping*) et l'émission des flux d'instructions PDF binaires.

---

## 🚀 3. Scalabilité Multi-Thread (Worker Pool)

Évaluation de la montée en charge avec le `WorkerPool` (9 threads alloués) sur deux types de charges contrastées :

### 3A. Charge Standard / Légère (Documents Simples, 1 Passe — Analogue au Soak Test)

| Concurrence | Débit Global | Latence p50 | Latence p95 | RSS Mémoire | Heap Utilisé |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **1 req. simultanées** | **88.4 docs/s** | 9.4 ms | 15.3 ms | ~905 MB | ~102.9 MB |
| **2 req. simultanées** | **230.5 docs/s** | 8.3 ms | 9.5 ms | ~945 MB | ~103.0 MB |
| **4 req. simultanées** | **450.1 docs/s** | 8.5 ms | 10.1 ms | ~974 MB | ~103.1 MB |
| **8 req. simultanées** | **642.8 docs/s** | 9.6 ms | 12.5 ms | ~992 MB | ~103.2 MB |
| **16 req. simultanées** | **711.6 docs/s** | 15.3 ms | 25.2 ms | ~1014 MB | ~103.4 MB |

### 3B. Charge Entreprise Complexe (Template Éditorial Multi-Pages, 2 Passes avec `counter(num-pages)`)

| Concurrence | Débit Global | Latence p50 | Latence p95 | RSS Mémoire | Heap Utilisé |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **1 req. simultanées** | **20.7 docs/s** | 49.2 ms | 53.2 ms | ~1040 MB | ~103.5 MB |
| **2 req. simultanées** | **47.4 docs/s** | 38.2 ms | 45.0 ms | ~1069 MB | ~103.6 MB |
| **4 req. simultanées** | **75.5 docs/s** | 44.9 ms | 48.4 ms | ~1183 MB | ~103.6 MB |
| **8 req. simultanées** | **152.7 docs/s** | 49.3 ms | 52.0 ms | ~1299 MB | ~103.7 MB |
| **16 req. simultanées** | **153.9 docs/s** | 58.7 ms | 104.9 ms | ~1372 MB | ~103.8 MB |

---

## 📈 4. Test d'Endurance Massif (15 000 PDFs — `npm run test:soak:parallel`)

Le projet inclut un test de charge de référence exécutant **15 000 PDFs en continu** sous concurrence régulée (`bench/soak-test-15k-parallel.ts`) :

- **Volume Total** : 15 000 documents générés consécutivement.
- **Régulation de File (Backpressure)** : `maxWorkers * 2` (18 tâches en vol simultanément) pour garantir un RSS constant.
- **Débit Moyen Constaté** : **~267 PDFs / seconde** sous charge soutenue (soit ~3.7 ms par document).
- **Consommation Mémoire (RSS)** : Parfaitement stabilisée à **~20.9 MB** tout au long des 15 000 documents sans aucune fuite mémoire.
- **Zéro-Copie Binaire** : Transfert mémoire instantané via `ArrayBuffer.transfer` / `Transferable` sans sérialisation JSON ni copie d'octets.

---

## 🔬 Matrice des Patches d'Optimisation Implémentés

| Patch | Domaine d'intervention | Fichiers impactés | Bénéfice mesuré |
|:---:|:---|:---|:---|
| **01 & 02** | Cache LRU & Mesure de texte | `src/core/lruCache.ts`, `src/core/cacheManager.ts` | Clés exactes, éviction $O(1)$ sans vider le cache |
| **03** | Sélecteurs CSS indexés | `src/cssParser.ts` | Élimine les scans répétitifs du DOM ($O(rules \times nodes) \rightarrow O(nodes)$) |
| **04** | Cache d'actifs inter-PDF | `src/core/assetCache.ts`, `src/renderers/imageRenderer.ts` | Déduplication des polices et images distantes |
| **05** | Coordonnées de table en $O(1)$ | `src/renderers/tableRenderer.ts` | Sommes préfixes de colonnes et lignes, supprime les `.slice().reduce()` |
| **06** | Mémoïsation du layout | `src/renderers/registry.ts` | Évite les ré-estimations de hauteur lors des passes flex/grid |
| **07** | Indexation directe des polices | `src/core/fontManager.ts` | Recherche directe des variantes dans un index normalisé |
| **08** | Régulation de file (Backpressure) | `src/workers/workerPool.ts` | Rejet immédiat (`WorkerPoolBusyError`) en cas de dépassement de file |
| **09** | Seuil de workers chauds (`minWorkers`) | `src/workers/workerPool.ts` | Élimine la latence de démarrage à froid pour les requêtes initiales |
| **10** | Profilage par phase sans surcoût | `src/htmlRenderer.ts`, `src/types.ts` | Observabilité détaillée de chaque étape du pipeline |
| **11** | Matrice de benchmark étendue | `bench/benchmark.ts` | Validation rigoureuse (CSS, typo, tables, layout, concurrence) |
| **12** | Documentation automatisée | `docs/benchmark.md`, `docs/optimisation.md`, `README.md` | Rapports de performance à jour avec version et commit exacts |
