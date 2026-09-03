# 🚀 HTML to PDF Lite Module (`html-to-pdf-lite-module`)

> Moteur minimal, ultra-performant et modulaire de génération HTML → PDF sous Node.js sans dépendance headless lourde (Puppeteer/Playwright). Utilise **pdfkit** (pur JS) + **cheerio** (DOM Fast AST).

---

## ⚡ Points Forts & Architecture

- **⚡ Débit Extrême (~270 PDFs / sec)** : Temps moyen par PDF abaissé à **3.71 ms / PDF** sur le Worker Pool.
- **🛡️ RAM Élastique à la Demande** : **0 worker au repos** (RAM serveur résiduelle **~116 MB**). Extinction automatique des workers inactifs après 10s pour rendre la mémoire à l'OS.
- **🔄 Transfert Zéro-Copie (`Transferable ArrayBuffers`)** : Transmission des flux binaires sans aucune duplication d'octets en mémoire IPC.
- **⚙️ Offloading CPU Réglable (Défaut 50% CPU)** : Allocation dynamique de worker threads secondaires avec plafonnement processeur pour préserver le serveur web.
- **🎯 Rendu Single-Pass Conditionnel** : Traitement en une seule passe par défaut, basculant en 2 passes uniquement si `counter(num-pages)` est présent.
- **🧠 Caches Optimizés (`WeakMap` & LRU)** : Caches intelligents pour les styles CSS et les hauteurs de texte sans fuite mémoire.
- **✅ Couverture >90% & Linter OXC** : 72 tests unitaires passés, 44 tests d'intégration, 0 avertissement linter `oxlint`.

---

## 📚 Documentation Détaillée

Consultez les guides d'architecture et de performance dans le dossier [`docs/`](docs/) :

- 📐 [**Architecture Technique (`docs/architecture.md`)**](docs/architecture.md) — Découpage modulaire SOLID, services Noyau, Renderers et Worker Pool.
- ⚡ [**Guide d'Optimisation (`docs/optimisation.md`)**](docs/optimisation.md) — Bilan des 13 optimisations de vitesse et mémoire.
- 📊 [**Rapport de Benchmark & Endurance (`docs/benchmark.md`)**](docs/benchmark.md) — Résultats des tests unitaires, multi-threads et d'endurance sur 15 000 PDFs (dont documents de >800 pages).

---

## 📦 Installation

```bash
npm install
```

---

## 💡 Utilisation

### Usage Standard (Single-Thread)

```js
import { createPdfGenerator } from './src/index.js';

const generator = createPdfGenerator({
  defaultFormat: 'A4',
  defaultOrientation: 'portrait',
  defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
});

const html = `
  <h1 style="color: #003366;">Rapport Annuel</h1>
  <p style="font-size: 14px;">Bonjour le monde !</p>
`;

const pdfBuffer = await generator.generate(html);
```

### Usage Multi-Thread Élastique (Production / Serveur HTTP)

```js
const generator = createPdfGenerator({
  useWorkerPool: true,  // Active le Worker Thread Pool élastique
  cpuRatio: 0.5,        // Mode Modéré : Plafond à 50% CPU (défaut)
  idleTimeoutMs: 10000, // Extinction des workers inactifs après 10s (défaut)
});

// Traitement déporté hors de l'Event Loop principal
const pdfBuffer = await generator.generate(html);

// Obtenir les diagnostics du pool en temps réel
console.log(generator.getWorkerStats());
// { totalWorkers: 1, freeWorkers: 1, activeTasks: 0, queuedTasks: 0, maxWorkers: 6 }

// Fermeture propre du pool lors de l'arrêt du serveur
await generator.terminateWorkerPool();
```

---

## 🎛️ Configuration & Options

### Options Globales (`createPdfGenerator(config)`)

| Option | Type | Défaut | Description |
|---|---|---|---|
| `defaultFormat` | `string` | `'A4'` | Format de page (`A3`, `A4`, `A5`, `Letter`, `Legal`) |
| `defaultOrientation` | `string` | `'portrait'` | Orientation (`portrait` ou `landscape`) |
| `defaultMargin` | `object` | `{ top:20, bottom:20, left:20, right:20 }` | Marges en points |
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
| **CSS Externe & Sélecteurs** | Balise (`p`), Classe (`.box`), ID (`#header`), Combinés (`div.active`) | ✅ |
| **Polices `@font-face`** | TTF/OTF via URL HTTP(s) ou Data URI `base64` (variantes bold/italic) | ✅ |
| **Zones de page `@page`** | 6 zones (`@top-left` à `@bottom-right`), `counter(page)`, `counter(num-pages)` | ✅ |
| **Tableaux Avancés** | `<table>`, `<thead>`, `tbody`, `colspan`, `rowspan`, bordures, tableaux imbriqués (5 niveaux) | ✅ |
| **Listes Imbriquées** | `<ul>`, `<ol>`, `<li>` avec indentation automatique | ✅ |
| **Images** | `<img>` local, HTTP, Data URI `base64`, redimensionnement automatique | ✅ |

---

## 🧪 Tests, Linter & Outillage

```bash
# 1. Tests manuels d'intégration (44 scénarios)
npm test

# 2. Couverture de code (>90% de lignes)
npm run test:coverage

# 3. Linter ultra-rapide (OXC)
npm run lint

# 4. Benchmarks unitaires
npm run benchmark

# 5. Tests d'endurance & de mémoire (200 / 10 000 PDFs)
npm run test:soak
```

---

## 📄 Licence

MIT