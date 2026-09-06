# 🚀 HTML to PDF Lite Module (`pdf-generator`) — v2.0.0

> Moteur minimal, ultra-performant et modulaire de génération HTML → PDF sous Node.js (≥ 18.18.0, incluant Node.js 20, 22 et 24) sans dépendance headless lourde (Puppeteer/Playwright).
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
- **🎯 AsyncDisposable (`await using`)** : Gestion moderne du cycle de vie des ressources (standard natif Node.js ≥ 22 & Node.js 24).
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

### 1. Depuis le registre npm (Recommandé)

```bash
npm install pdf-generator
# ou avec pnpm / yarn
pnpm add pdf-generator
yarn add pdf-generator
```

### 2. Depuis GitHub directement

Vous pouvez installer le paquet directement depuis son dépôt GitHub sans passer par npm :

```bash
# Via le raccourci GitHub (branche par défaut / main)
npm install github:morvaivor/html-to-pdf-lite-module

# Ou via l'URL git complète
npm install git+https://github.com/morvaivor/html-to-pdf-lite-module.git

# En ciblant une branche, un tag ou un commit précis
npm install github:morvaivor/html-to-pdf-lite-module#v2.0.0
npm install github:morvaivor/html-to-pdf-lite-module#main
```

> **ℹ️ Note** : Grâce au script `prepare` intégré au projet, npm compile automatiquement les sources TypeScript (`npm run build`) lors de l'installation directe depuis GitHub.

### 3. Depuis les sources locales (Clone Git)

Idéal pour développer, modifier ou tester le moteur localement :

```bash
# 1. Cloner le dépôt
git clone https://github.com/morvaivor/html-to-pdf-lite-module.git
cd html-to-pdf-lite-module

# 2. Installer les dépendances et compiler le dossier dist/
npm install
npm run build
```

Pour utiliser ensuite cette version locale dans un autre projet :

- **Option A — Lien symbolique (`npm link`)** (recommandé pour le développement) :
  ```bash
  # Dans le dossier html-to-pdf-lite-module :
  npm link

  # Dans votre projet consommateur :
  npm link pdf-generator
  ```
- **Option B — Chemin direct (`file:`)** :
  ```bash
  # Dans votre projet consommateur :
  npm install /chemin/absolu/vers/html-to-pdf-lite-module
  # ou en relatif dans votre package.json :
  # "dependencies": { "pdf-generator": "file:../html-to-pdf-lite-module" }
  ```
- **Option C — Archive tarball (`npm pack`)** (identique à un paquet npm publié) :
  ```bash
  # Dans html-to-pdf-lite-module :
  npm pack
  # Génère pdf-generator-2.0.0.tgz

  # Dans votre projet consommateur :
  npm install /chemin/vers/pdf-generator-2.0.0.tgz
  ```

---

## 💡 Intégration dans un Projet SANS TypeScript (JavaScript Pur)

Bien que le moteur soit développé en TypeScript pour des raisons de robustesse, **TypeScript n'est absolument pas requis** dans votre projet. Le paquet distribue du JavaScript standard compilé (`dist/index.js`).

### Cas 1 : Projet JavaScript en ES Modules (`"type": "module"` ou `.mjs`) — Recommandé

Si votre `package.json` contient `"type": "module"` ou si vous utilisez l'extension `.mjs`, vous pouvez importer le module avec la syntaxe standard `import` :

```javascript
// index.js (avec "type": "module" dans package.json) ou index.mjs
import { createPdfGenerator } from 'pdf-generator';
import { writeFileSync } from 'node:fs';

const generator = createPdfGenerator({
  defaultFormat: 'A4',
  defaultOrientation: 'portrait',
  defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
});

const html = `
  <h1 style="color: #003366;">Rapport d'Activité</h1>
  <p style="font-size: 14px;">Document généré depuis un projet JavaScript pur !</p>
`;

const pdfBuffer = await generator.generate(html);
writeFileSync('rapport.pdf', pdfBuffer);
console.log('PDF généré avec succès !');
```

#### Gestion du Worker Pool en JavaScript :
- **Node.js 24 & Node.js ≥ 22** : Vous bénéficiez du mot-clé natif `await using` sans TypeScript :
  ```javascript
  await using generator = createPdfGenerator({ useWorkerPool: true });
  const pdfBuffer = await generator.generate(html);
  // Extinction et nettoyage automatique des workers à la sortie du bloc
  ```
- **Node.js < 22** : Libération explicite avec `try / finally` :
  ```javascript
  const generator = createPdfGenerator({ useWorkerPool: true });
  try {
    const pdfBuffer = await generator.generate(html);
  } finally {
    // Ferme proprement les threads secondaires
    await generator.terminateWorkerPool();
  }
  ```

### Cas 2 : Projet JavaScript en CommonJS (`require`)

Le paquet étant distribué en ESM natif, l'utilisation directe de `const { createPdfGenerator } = require('pdf-generator')` lèvera une erreur `ERR_REQUIRE_ESM`.

Dans un projet CommonJS (`.cjs` ou sans `"type": "module"`), utilisez l'**import dynamique** `await import()` :

```javascript
// index.js (projet CommonJS)
const fs = require('node:fs');

async function genererMonDocument() {
  // Import dynamique compatible CommonJS
  const { createPdfGenerator } = await import('pdf-generator');

  const generator = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
  });

  const html = '<h1>Facture CommonJS</h1><p>Génération réussie via import dynamique.</p>';
  const pdfBuffer = await generator.generate(html);

  fs.writeFileSync('facture.pdf', pdfBuffer);
  console.log('Facture créée avec succès.');
}

genererMonDocument().catch(console.error);
```

### 💡 Autocomplétion & IntelliSense en JavaScript (JSDoc)

Même sans TypeScript, les éditeurs modernes (VS Code, WebStorm, etc.) détectent automatiquement le fichier `dist/index.d.ts` inclus. Vous bénéficiez immédiatement de **l'autocomplétion des options, de la validation des valeurs et de la documentation inline au survol**.

Vous pouvez également typer vos variables en JavaScript pur grâce aux annotations JSDoc :

```javascript
/** @type {import('pdf-generator').PdfGeneratorConfig} */
const config = {
  defaultFormat: 'A4', // L'IDE propose : 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal'
  defaultOrientation: 'portrait',
};
```

---

## 💡 Utilisation en TypeScript

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

### Usage Multi-Thread Élastique avec `await using` (Node.js 22 & 24)

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

## 📚 Documentation

- [Architecture & Design](docs/architecture.md) — Documentation de l'architecture logicielle
- [Optimisations & Performance](docs/optimisation.md) — Stratégies de performance et gestion de la mémoire
- [Rapport de Benchmark](docs/benchmark.md) — Métriques et tests de charge
- [CI/CD, Dependabot & SemVer](docs/ci-cd.md) — Automatisations GitHub Actions, Dependabot et releases Release Please

---

## 📄 Licence

MIT © [pdf-generator contributors](LICENSE)