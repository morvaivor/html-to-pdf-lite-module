# Architecture Technique — `pdf-generator` (v2.0.0)

## 📐 Vue d'Ensemble & Structure Modulaire

`pdf-generator` est un moteur léger de conversion HTML + CSS vers PDF sous Node.js (≥ 18.18.0) sans dépendance vers un navigateur headless (Chromium / Puppeteer).  
Le moteur est développé en **TypeScript strict**, structuré selon les principes **SOLID** et inclut un pool de Worker Threads **100% élastique et à la demande** (Mode Modéré par défaut : 50% CPU, RAM hors charge ~116 MB).

```
src/
├── index.ts                     # Point d'entrée du package & ré-exports de types
├── pdfGenerator.ts              # Façade principale (API publique, AsyncDisposable & diagnostics)
├── htmlRenderer.ts              # Orchestrateur du pipeline de rendu HTML → PDF
├── cssParser.ts                 # Parser CSS (règles, sélecteurs, @font-face, @page)
├── qualityAuditor.ts            # Auditeur de fidélité visuelle et complétude du PDF
├── types.ts                     # Source de vérité des types & interfaces TypeScript
├── core/
│   ├── PageLayout.ts            # Géométrie et limites de page immuables
│   ├── cacheManager.ts          # TextMeasureCache (LRU) et WeakMap style cache
│   ├── fontManager.ts           # Téléchargement et enregistrement sécurisé des polices
│   └── networkSecurity.ts       # Bouclier de sécurité SSRF, Path Traversal et DoS
├── renderers/
│   ├── registry.ts              # Strategy Pattern : Element Handler Registry
│   ├── textRenderer.ts          # Rendu des paragraphes et nœuds de texte
│   ├── tableRenderer.ts         # Moteur de tableau (matrice 2D, colspan/rowspan, pagination atomique)
│   ├── listRenderer.ts          # Rendu des listes ul, ol, li
│   ├── imageRenderer.ts         # Rendu sécurisé des images (local cwd, HTTP, base64)
│   └── headerFooterRenderer.ts  # Rendu des zones @page et templates header/footer
└── workers/
    ├── pdfWorker.ts             # Handler exécuté sur les Worker Threads secondaires (Zero-Copy)
    └── workerPool.ts            # Gestionnaire du pool élastique à la demande (Dynamic Scale Up/Down)
```

---

## 🔬 Algorithmes Clés & Modules Complexes

### 1. Rendu des Tableaux (`renderers/tableRenderer.ts`)
Le moteur de tableau résout un problème géométrique complexe :
- **Matrice 2D virtuelle (`gridCells`)** : chaque ligne calcule la première colonne libre disponible en propageant les cellules des lignes supérieures qui ont un `rowspan` actif.
- **Pagination Atomique (`blocks`)** : regroupe les lignes reliées par des `rowspan` en "blocs insécables". Si le bloc dépasse l'espace restant sur la page courante (`doc.y + blockHeight > layout.pageBottom`), un saut de page est effectué avant d'entamer le bloc, évitant de couper une cellule multi-lignes en deux.
- **Tableaux Imbriqués Récursifs** : calcule récursivement la hauteur des sous-tableaux imbriqués pour ajuster la hauteur totale de la cellule parente.

### 2. Pipeline de Rendu & Monkey-Patching (`htmlRenderer.ts`)
- **Single-Pass AST & Shared DOM** : l'arbre Cheerio n'est parsé qu'une fois.
- **Hook Réactif `doc.addPage()`** : la méthode native de PDFKit est interceptée pour injecter automatiquement sur chaque page générée les en-têtes, pieds de page, ainsi que les 6 zones `@page` du CSS (`@top-left`, `@bottom-center`, etc.).
- **Passage Conditionnel en 2 Passes** : si et seulement si `counter(num-pages)` est détecté dans le CSS, une passe préliminaire rapide sans écriture buffer (`countPages`) est exécutée pour connaître le nombre total de pages à l'avance.

### 3. Analyse CSS sans Risque ReDoS (`cssParser.ts`)
- **Compteur de Profondeur d'Accolades (`depth`)** : l'extraction des blocs `@page` et `@font-face` s'effectue par comptage itératif d'accolades équilibrées plutôt que par des expressions régulières avec quantification imbriquée, éliminant tout risque de blocage ReDoS.

### 4. Auditeur de Qualité & Conformité Visuelle (`qualityAuditor.ts`)
Le module intègre un moteur autonome de validation de fidélité documentaire :
- **Décompression & Analyse de Flux PDF** : décompression du flux binaire (`node:zlib`) et extraction des opérateurs vectoriels (lignes, courbes, rectangles, couleurs, textes).
- **Complétude Textuelle** : comparaison mot à mot entre le texte extrait du DOM HTML source et celui présent dans le PDF pour garantir qu'aucun paragraphe n'a été tronqué ou occulté.
- **Audit Structurel & Layout** : vérification de la présence effective des titres (`h1`-`h6`), des tableaux, des listes, des images et des graphismes SVG.
- **Score de Fidélité** : calcul automatique d'une note de 0 à 100 assortie d'un grade qualitatif (`A+` à `F`).

---

## ⚙️ Worker Pool Élastique à la Demande (`workers/`)

- **0 Worker au repos (RAM ~116 MB)** : Au démarrage, aucun worker n'est réservé en mémoire.
- **Scale-Up dynamique** : Dès que des requêtes concurrentes arrivent, les workers sont instanciés à la demande jusqu'à `maxWorkers` (défaut `cpuRatio: 0.5` soit **50% des cœurs processeur**).
- **Transfert Zéro-Copie (`ArrayBuffer.transfer` / `Transferable ArrayBuffers`)** : Transmission des flux PDF binaires sans duplication mémoire inter-threads.
- **Scale-Down & Auto-Extinction** : Après `idleTimeoutMs` (défaut : 10s d'inactivité), chaque worker s'éteint automatiquement et rend sa mémoire RAM au système d'exploitation.
- **AsyncDisposable** : Support natif du protocole `[Symbol.asyncDispose]()` pour une destruction garantie en sortie de bloc `await using`.
- **Diagnostics (`generator.getWorkerStats()`)** : Retourne en temps réel le nombre de workers actifs, libres, et de tâches en file d'attente.

---

## 🛡️ Couche de Sécurité Réseau & Fichiers (`networkSecurity.ts`)

1. **Validation SSRF** :
   - Contrôle strict du protocole (`http:` ou `https:` uniquement).
   - Rejet automatique des adresses loopback (`localhost`, `127.0.0.1`, `::1`), des réseaux locaux privés (RFC 1918 : `10.x`, `172.16-31.x`, `192.168.x`), des adresses link-local (`169.254.x`), et des endpoints de métadonnées de fournisseurs cloud (`metadata.google.internal`, AWS `169.254.169.254`, etc.).
2. **Isolation Système de Fichiers** :
   - Tout chargement d'image par chemin local est validé par `readLocalFile` pour garantir que le chemin résolu demeure strictement dans `process.cwd()`.
3. **Protection DoS et Mémoire** :
   - Timeout automatique de 30 secondes (`AbortSignal.timeout(30_000)`).
   - Plafonnement de taille maximale pour les ressources distantes à **50 Mo** et les payloads Base64 à **10 Mo**.

---

## 📦 Chaîne de Compilation & Distribution Multi-Cibles

Le projet s'appuie sur la suite **OXC (The JavaScript Oxidation Compiler)** :
- **Compilateur `tsdown`** (Rolldown + OXC) : produit un bundle ESM pur (`dist/index.js`) ultra-rapide (~100 ms) ainsi que le bundle du worker (`dist/workers/pdfWorker.js`).
- **Déclarations TypeScript (`dist/index.d.ts`)** : générées via *isolated declarations* pour un typage strict sans ralentir le build.
- **Interopérabilité Consommateurs** :
  - **TypeScript** : typage strict et auto-complétion native sans configuration.
  - **JavaScript ESM** : consommation directe via `import { createPdfGenerator } from 'pdf-generator'`.
  - **JavaScript CommonJS** : intégration transparente via import dynamique `await import('pdf-generator')`.
  - **Installation Git / GitHub** : le script `"prepare": "npm run build"` garantit la compilation immédiate du dossier `dist/` dès l'installation par `npm install git+...`.
