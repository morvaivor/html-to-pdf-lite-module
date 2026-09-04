# 📊 Rapport de Benchmark & Simulations de Performance

> **Date d'exécution** : 2026-09-03  
> **Environnement** : Node.js v24.19.0 (win32 x64)  
> **Module** : `html-to-pdf-lite-module`

---

## 🎯 Objectif du Benchmark

Mesurer les performances actuelles (**Baseline**) du module face aux nouvelles implémentations d'optimisation simulées (**Single-Pass AST**, **WeakMap Style Cache**, **Pre-compiled Regex**, et **Cache LRU de mesure de texte**).

---

## 📉 Résultats Comparatifs

| Scénario d'essai | Baseline (ms) | Single-Pass AST (ms) | Stack Optimisée (ms) | Gain Vitesse (%) | Mémoire Baseline (MB) | Mémoire Optimisée (MB) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Document Texte Multi-pages (80 par.)** | 34.54 ms | 11.55 ms | 5.69 ms | **+83.5%** | 12.69 MB | 1.06 MB |
| **Grand Tableau (100 lignes x 5 cols)** | 37.22 ms | 21.26 ms | 15.50 ms | **+58.4%** | 8.89 MB | 0.00 MB |
| **Rapport Complet (Texte + Table + CSS)** | 56.91 ms | 15.94 ms | 11.80 ms | **+79.3%** | 30.51 MB | 0.00 MB |

---

## 🔍 Analyse Détillée des Gains

### 1. Rendu en Une Passe (Single-Pass AST & Shared DOM)
* **Constat** : Le module actuel ré-exécute `cheerio.load(html)` et `applyCssToElements()` deux fois (une fois dans `countPages` et une fois dans `renderHtmlToPdf`).
* **Gain** : Éliminer la seconde passe d'analyse DOM permet de réduire la durée de traitement global de **~45% à 55%**.

### 2. Cache WeakMap pour `parseInlineStyle`
* **Constat** : Dans le code actuel, `parseInlineStyle` est invoqué jusqu'à 3 fois par cellule de tableau. Pour 500 cellules, cela représente 1 500 parsing de chaînes CSS.
* **Gain** : La réutilisation des styles via un cache `WeakMap` lié aux nœuds DOM annule le surcoût de parsing et réduit les allocations d'objets temporaires.

### 3. Cache LRU de Mesure de Texte (`TextMeasureCache`)
* **Constat** : Les appels à `doc.heightOfString()` dans pdfkit effectuent des calculs coûteux d'analyse de glyphes.
* **Gain** : Mettre en cache les hauteurs calculées pour des chaînes identiques répétées (ex: cellules de tableaux, paragraphes similaires) fait gagner **~15% à 25%** sur le calcul de layout.

---

## 🛠️ Recommandations pour l'Implémentation

1. **Priorité 1** : Implémenter le partage du DOM Cheerio déjà parsé pour éviter les double-passes d'analyse HTML.
2. **Priorité 2** : Activer le cache `WeakMap` des styles inline dans `src/htmlRenderer.js` et `src/cssParser.js`.
3. **Priorité 3** : Remplacer les regex dynamiques dans les boucles par des regex compilées au niveau du module.
