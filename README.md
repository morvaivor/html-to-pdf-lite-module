# 🚀 HTML to PDF Lite Module (`pdf-generator`) — v2.0.0

> Moteur minimal, ultra-performant et modulaire de génération HTML → PDF sous Node.js (≥ 18.18.0) sans dépendance headless lourde (Puppeteer/Playwright).
> Développé en **TypeScript strict** et propulsé par la stack **OXC (The JavaScript Oxidation Compiler)** : `tsdown`, `oxlint`, `oxfmt`.

---

## ⚡ Points Forts & Architecture

- **⚡ Toolchain OXC Sub-Centiseconde** : Build complet en **~100 ms** via `tsdown` (Rolldown + OXC) avec génération de `.d.ts` via *isolated declarations*.
- **🛡️ Sécurité Hardened (Zero-Trust)** :
  - **SSRF Shield** : Blocage préventif des réseaux privés, IPs locales et endpoints de métadonnées cloud (AWS, GCP, Azure).
  - **Path Traversal Protection** : Résolution sécurisée bornée au répertoire de travail (`process.cwd()`).
  - **Déni de Service (DoS/OOM)** : Quotas de taille stricts (50 Mo HTTP, 10 Mo base64) et timeouts réseau (30s).
- **⚡ Débit Extrême (~270 PDFs / sec)** : Traitement multi-thread déporté via `WorkerPool`.
- **🛡️ RAM Élastique à la Demande** : **0 worker au repos** (~116 MB résiduel). Extinction automatique des threads inactifs après 10s pour rendre la mémoire à l'OS.
- **🔄 Transfert Zéro-Copie (`ArrayBuffer.transfer` / `Transferable`)** : Aucun surcoût de sérialisation ou duplication mémoire lors du transfert inter-thread des flux PDF.
- **⚙️ Offloading CPU Réglable (Défaut 50% CPU)** : Allocation dynamique de worker threads secondaires avec limitation CPU pour préserver l'Event Loop de votre serveur HTTP.
- **🎯 AsyncDisposable (`await using`)** : Gestion moderne du cycle de vie des ressources (Node.js ≥ 22).
- **🧠 Caches Optimisés (`WeakMap` & LRU)** : Caches de calculs typographiques et de styles CSS sans fuite mémoire.
- **✅ Qualité & Conformité** : 72 tests unitaires, 44 tests d'intégration, typage strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`).

---

## 📚 Documentation Détaillée

Consultez les guides dans le dossier [`docs/`](docs/) et le guide de mise à niveau :

- 📘 [**Guide de Migration v1 → v2 (`MIGRATION.md`)**](MIGRATION.md) — Passage en TypeScript, breaking changes d'imports et fonctionnalités v2.
- 📐 [**Architecture Technique (`docs/architecture.md`)**](docs/architecture.md) — Découpage SOLID, services Core, Renderers et Worker Pool.
- ⚡ [**Guide d'Optimisation (`docs/optimisation.md`)**](docs/optimisation.md) — Bilan des optimisations de vitesse et mémoire.
- 📊 [**Rapport de Benchmark & Endurance (`docs/benchmark.md`)**](docs/benchmark.md) — Résultats des tests unitaires, multi-threads et d'endurance sur 15 000 PDFs.

---

## 📦 Installation

```bash
npm install pdf-generator
```

---

## 💡 Utilisation

### Usage Standard (Single-Thread)

```typescript
import { createPdfGenerator } from 'pdf-generator';

const generator = createPdfGenerator({
  defaultFormat: 'A4',
  defaultOrientation: 'portrait',
  defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
});

const html = `
  <h1 style="color: #003366;">Rapport d'Activité</h1>
  <p style="font-size: 14px;">Document généré avec succès !</p>
`;

const pdfBuffer = await generator.generate(html);
```

### Usage Multi-Thread Élastique avec `await using` (Node.js ≥ 22)

```typescript
import { createPdfGenerator } from 'pdf-generator';

// Libération et arrêt automatique du Worker Pool en sortie de scope
await using generator = createPdfGenerator({
  useWorkerPool: true,  // Active le Worker Thread Pool élastique
  cpuRatio: 0.5,        // Mode Modéré : Plafond à 50% CPU (défaut)
  idleTimeoutMs: 10000, // Extinction des workers inactifs après 10s (défaut)
});

// Traitement déporté hors de l'Event Loop principal (Zero-Copy)
const pdfBuffer = await generator.generate(html);

// Diagnostics en temps réel
console.log(generator.getWorkerStats());
// { totalWorkers: 1, freeWorkers: 1, activeTasks: 0, queuedTasks: 0, maxWorkers: 6 }
```

---

## 🎛️ Configuration & Options

### Options Globales (`createPdfGenerator(config)`)

| Option | Type | Défaut | Description |
|---|---|---|---|
| `defaultFormat` | `PaperFormat` | `'A4'` | Format de page (`'A3'`, `'A4'`, `'A5'`, `'Letter'`, `'Legal'`) |
| `defaultOrientation` | `Orientation` | `'portrait'` | Orientation (`'portrait'` ou `'landscape'`) |
| `defaultMargin` | `MarginOptions` | `{ top:20, bottom:20, left:20, right:20 }` | Marges en points |
| `css` | `string` | `''` | CSS global (sélecteurs, `@font-face`, `@page`) |
| `header` | `string` | `''` | Template HTML de l'en-tête |
| `footer` | `string` | `''` | Template HTML du pied de page (`{page}`, `{totalPages}`) |
| `useWorkerPool` | `boolean` | `false` | Active le Worker Thread Pool à la demande |
| `cpuRatio` | `number` | `0.5` | Ratio maximal de cœurs CPU utilisés (0.5 = 50% CPU) |
| `maxWorkers` | `number` | `null` | Nombre d'unités d'exécution secondaires explicites |
| `idleTimeoutMs` | `number` | `10000` | Délai avant auto-extinction des workers inactifs (ms) |

---

## 🎨 Fonctionnalités HTML & CSS Supportées

| Élément / Propriété | Exemple | Support |
|---|---|:---:|
| **Balises de texte** | `<h1>`-`<h6>`, `<p>`, `<div>`, `<span>`, `<br>`, `<a>` | ✅ |
| **Styles Inline** | `color`, `font-size`, `font-weight`, `font-style`, `font-family`, `text-align`, `border`, `padding`, `background-color` | ✅ |
| **CSS Avancé** | `line-height`, `letter-spacing`, `text-decoration` (`underline`/`line-through`), `margin`/`margin-*`, `text-transform`, `border-radius` | ✅ |
| **Layout Flex & Grid** | `display: flex` / `display: grid`, `grid-template-columns` (`fr`), `gap`, `flex-direction` | ✅ |
| **CSS Externe & Sélecteurs** | Balise (`p`), Classe (`.box`), ID (`#header`), Combinés (`div.active`) | ✅ |
| **Polices `@font-face`** | TTF/OTF via URL HTTP(s) ou Data URI `base64` (variantes bold/italic) | ✅ |
| **Zones de page `@page`** | 6 zones (`@top-left` à `@bottom-right`), `counter(page)`, `counter(num-pages)` | ✅ |
| **Tableaux Avancés** | `<table>`, `<thead>`, `<tbody>`, `colspan`, `rowspan`, bordures, tableaux imbriqués (5 niveaux) | ✅ |
| **Listes Imbriquées** | `<ul>`, `<ol>`, `<li>` avec indentation automatique | ✅ |
| **Images** | `<img>` local (restreint au `cwd`), HTTP/HTTPS validé, Data URI `base64` borné | ✅ |

---

## 🧪 Scripts de Développement (Stack OXC)

```bash
# 1. Compilation & Bundling rapide (tsdown)
npm run build

# 2. Vérification statique des types
npm run typecheck

# 3. Linter OXC
npm run lint

# 4. Formateur OXC (oxfmt)
npm run format

# 5. Tests unitaires et couverture (>90%)
npm run test:coverage

# 6. Tests manuels d'intégration (47 scénarios)
npm test

# 7. Benchmarks
npm run benchmark
```

---

## 📄 Licence

MIT © [pdf-generator contributors](LICENSE)