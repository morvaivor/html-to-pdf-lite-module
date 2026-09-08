# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) or [Release Please](https://github.com/googleapis/release-please) for automated commit specifications.

## [2.4.0](https://github.com/morvaivor/html-to-pdf-lite-module/compare/v2.3.0...v2.4.0) (2026-09-08)


### Features

* add [@font-face](https://github.com/font-face) support (TTF/OTF via url() http(s) and data URI) ([5642dde](https://github.com/morvaivor/html-to-pdf-lite-module/commit/5642dde64bda246d3b5783b56a2009415c703a28))
* add [@page](https://github.com/page) CSS rule support for headers/footers with counter(page) ([a16ac22](https://github.com/morvaivor/html-to-pdf-lite-module/commit/a16ac2213eb6dc5a8184b01120a0c2e0649ca5e5))
* add benchmark and optimization documentation for html-to-pdf-lite-module ([748485c](https://github.com/morvaivor/html-to-pdf-lite-module/commit/748485cd31e2e73914df1d2051fe221860027aed))
* add external CSS support (config, classes, IDs, per-call override) ([574f56a](https://github.com/morvaivor/html-to-pdf-lite-module/commit/574f56aee02aac3f9f337e64cbd9ec27c3d4aef3))
* add header and footer support with page numbering ({page} / {totalPages}) ([7ae79f4](https://github.com/morvaivor/html-to-pdf-lite-module/commit/7ae79f48ed0b7592ad016ed67e2046e2ca832ea2))
* add image support (data URI, local files, URLs, width/height, pagination) ([9fe99c2](https://github.com/morvaivor/html-to-pdf-lite-module/commit/9fe99c24ec57ec15bba0cf9d0cd11cd5fb6b6430))
* add legal contract template and generate heavy financial ledger script ([afd1284](https://github.com/morvaivor/html-to-pdf-lite-module/commit/afd1284a844c4e35d7aca57fd09ab065dd193300))
* add list rendering support (ul, ol, li, nested lists, pagination) ([746254d](https://github.com/morvaivor/html-to-pdf-lite-module/commit/746254dcb38afa36128fc58215ec501f54083868))
* add logging capabilities and enhance PDF generation options ([0d0c6a7](https://github.com/morvaivor/html-to-pdf-lite-module/commit/0d0c6a7878012d9783ce668baf30e6a700176ada))
* add rowspan support for tables ([23ec60a](https://github.com/morvaivor/html-to-pdf-lite-module/commit/23ec60afae5da41a9f28480daaab2df5801945f4))
* add table rendering support (thead, tbody, tr, td, th, colspan, borders, padding, CSS) ([4d13fd7](https://github.com/morvaivor/html-to-pdf-lite-module/commit/4d13fd726837cde7b9d425888ec1a2c7afd263f3))
* ajouter des instructions d'installation et de configuration dans le README ([0a12e89](https://github.com/morvaivor/html-to-pdf-lite-module/commit/0a12e896b67b72f37d3c74da0fb3929806da2e1d))
* ajouter l'audit de qualité de rendu pour les PDF générés et améliorer la gestion des styles ([32840d2](https://github.com/morvaivor/html-to-pdf-lite-module/commit/32840d296c441df6da96eafa2ae6e705d35d1da8))
* ajouter la démo GitHub Pages avec 5 exemples HTML-to-PDF et suivi des tests ([744f4d7](https://github.com/morvaivor/html-to-pdf-lite-module/commit/744f4d777ac06b8f9388dd5dafe91c86b34d5411))
* ajouter la gestion du cache de résolution des polices et améliorer le calcul de la hauteur des éléments ([3a04ae1](https://github.com/morvaivor/html-to-pdf-lite-module/commit/3a04ae1021ab615817f140791c2d06e1adb72e8c))
* ajouter la prise en charge des mises en page flexibles et en grille, améliorer la gestion des styles et des tests associés ([c97d592](https://github.com/morvaivor/html-to-pdf-lite-module/commit/c97d5929278ea303b2334bf86f9a2d9ad251c4b2))
* ajouter le support de text-decoration (underline/line-through) + tests 46/47 ([c40acf5](https://github.com/morvaivor/html-to-pdf-lite-module/commit/c40acf55d42f9fa804b94206caf2cf0068e646d1))
* Améliorer le rendu des tableaux et des listes, optimiser le parsing CSS ([89edd99](https://github.com/morvaivor/html-to-pdf-lite-module/commit/89edd9965fb6de8f0de8ce38e7671e51b6685cee))
* améliorer le traitement des styles CSS et la gestion des largeurs de colonnes dans le rendu des tableaux ([d7d6f43](https://github.com/morvaivor/html-to-pdf-lite-module/commit/d7d6f43c2dac7e4c6c9ce3af956b66f1c2764c4b))
* **ci:** add dependabot, commitlint, and release please workflow ([27e672e](https://github.com/morvaivor/html-to-pdf-lite-module/commit/27e672e0d05d1efd94ad93bda98fddba3a528bd8))
* **ci:** add dependabot, commitlint, and release please workflow ([a17fe26](https://github.com/morvaivor/html-to-pdf-lite-module/commit/a17fe265eae4bf461f3baf971c4114d29a7037d8))
* **css-logs:** support du CSS sur IP locales planifiees et mode verbose multi-niveaux ([#14](https://github.com/morvaivor/html-to-pdf-lite-module/issues/14)) ([0e09ec3](https://github.com/morvaivor/html-to-pdf-lite-module/commit/0e09ec3cd8320fbbeec1b9d574e2847f62baa839))
* **demo:** ajout de 5 nouveaux modèles HTML variés et d'un stress-test volumique ([1d7a02d](https://github.com/morvaivor/html-to-pdf-lite-module/commit/1d7a02d332a2968b882dcc86249bc7bc04d18109))
* Enhance documentation and performance benchmarks for pdf-generator v2.0.0 ([bd9b8e2](https://github.com/morvaivor/html-to-pdf-lite-module/commit/bd9b8e2ac33438f5828e8c30e4e04ff83e887f4e))
* enhance rendering capabilities and style handling ([05aa264](https://github.com/morvaivor/html-to-pdf-lite-module/commit/05aa2644b043f95d7e0898396280dd2c2e015c0d))
* enhance rendering performance and flexibility ([d078339](https://github.com/morvaivor/html-to-pdf-lite-module/commit/d0783393f3a840574651941690e0a2a3fc5a58d0))
* HTML to PDF generator with pagination, CSS inline, and page options ([a1130fe](https://github.com/morvaivor/html-to-pdf-lite-module/commit/a1130feafa12af7354799744fc8ba57942bee48b))
* Implement list and table rendering in PDF generator ([3829265](https://github.com/morvaivor/html-to-pdf-lite-module/commit/3829265d8788f76d6b166834a424cb4f203fa76f))
* mise à jour de la version à 2.3.0 et ajout de nouveaux modèles HTML dans le changelog ([e126277](https://github.com/morvaivor/html-to-pdf-lite-module/commit/e126277265ddac125689b852c7d1a872cae2b102))
* optimize render css style add a github pages ([8248b7a](https://github.com/morvaivor/html-to-pdf-lite-module/commit/8248b7ad59bd6ed9e7c726439f051a2ce3bce3a2))
* **perf:** optimize rendering pipeline, memory stability and test coverage ([#10](https://github.com/morvaivor/html-to-pdf-lite-module/issues/10)) ([1411c8c](https://github.com/morvaivor/html-to-pdf-lite-module/commit/1411c8cae45e49fc34e1f4f1e0f84cc78ff85139))
* remove unused import from cacheManager in extendedCoverage tests ([b6c60ab](https://github.com/morvaivor/html-to-pdf-lite-module/commit/b6c60ab63e2856ad67c02066c550db91970c248c))
* support nested tables up to 5 levels deep ([eedda24](https://github.com/morvaivor/html-to-pdf-lite-module/commit/eedda2484a003fcde7350c3774729ee81a864b5f))
* supprimer la branche de déploiement pour GitHub Pages ([a0d23c8](https://github.com/morvaivor/html-to-pdf-lite-module/commit/a0d23c85973463d5430ddf1934a54666038204a5))
* supprimer le workflow de déploiement vers GitHub Pages ([80609c0](https://github.com/morvaivor/html-to-pdf-lite-module/commit/80609c067bf67d1bfe6d52fca7e3a19045f87cd7))
* update version to 2.1.0 and enhance changelog with performance optimizations and CI/CD improvements ([4c5b57b](https://github.com/morvaivor/html-to-pdf-lite-module/commit/4c5b57b695b168b8a8d9b71d36b33653bc70ff0e))


### Bug Fixes

* **ci:** installer unrun en devDependency et passer Node.js à v22 pour tsdown ([fffe0ca](https://github.com/morvaivor/html-to-pdf-lite-module/commit/fffe0ca83e74dea2dcb08187adeec426e14af0a7))
* correct list pagination by using doc.x/doc.y positioning instead of explicit coordinates ([45bfe15](https://github.com/morvaivor/html-to-pdf-lite-module/commit/45bfe1546967c4ba328a28c150124e29a35d99d1))
* header/footer rendering and page numbering on multi-page PDFs ([582a9ec](https://github.com/morvaivor/html-to-pdf-lite-module/commit/582a9ec38ed071297a841f14a832e8df03990ede))
* **lint:** corriger les 9 erreurs oxlint (node: protocol, imports et variable inutilisés) ([d1596dd](https://github.com/morvaivor/html-to-pdf-lite-module/commit/d1596dda73108aa08254c7948de44c48ab457fbd))
* **lint:** corriger les 9 erreurs oxlint (node: protocol, imports et variable inutilisés) ([423ce54](https://github.com/morvaivor/html-to-pdf-lite-module/commit/423ce540d29f3ccf8478ef65ba0c1c52357677b1))
* prevent double rendering of block elements with single text child ([da4fe94](https://github.com/morvaivor/html-to-pdf-lite-module/commit/da4fe94ec6a96f8b7c367ac3c9de4b1d8a64755d))
* reserve space for header/footer in pagination to prevent blank pages ([1c1d356](https://github.com/morvaivor/html-to-pdf-lite-module/commit/1c1d3563113ebccd3b59e7ca079d573d4942d99a))
* save/restore cursor position after drawing header/footer to prevent blank pages ([f0f57b7](https://github.com/morvaivor/html-to-pdf-lite-module/commit/f0f57b7393b986874ce3ddc3dca8d1a588f4f7af))
* update changelog link to relative path in CI/CD documentation ([459682f](https://github.com/morvaivor/html-to-pdf-lite-module/commit/459682fdc90cc59b9b8bbad8837a0416cd0c9c3c))
* use Helvetica-Oblique instead of Helvetica-Italic for Standard 14 fonts ([d81e829](https://github.com/morvaivor/html-to-pdf-lite-module/commit/d81e829b776a07e3bcaba3241e460748cd665f03))

## [2.3.0] - 2026-09-07

### 🎨 Showcase & Démonstrations Interactives
- **5 Nouveaux Modèles HTML Diversifiés (`demo/templates/`)** :
  - `6-tech-resume.html` : Curriculum Vitae & profil tech senior avec structure bi-colonne, badges de compétences techniques, timeline d'expériences et certifications (Fidélité : 100% A+).
  - `7-medical-report.html` : Compte-rendu médical d'analyses biologiques accrédité ISO 15189 avec en-tête hospitalier, code-barres de prélèvement SVG, 3 tableaux denses (NFS, biochimie, lipides) et pastilles de statut colorées (Fidélité : 100% A+).
  - `8-restaurant-menu.html` : Menu gastronomique de restaurant étoilé avec typographie soignée à empattements (serif), filets dorés, badges allergènes/végétariens et accords mets-vins (Fidélité : 95% A+).
  - `9-legal-contract.html` : Accord bilatéral de confidentialité (NDA B2B) avec structure juridique formelle, articles et clauses numérotés, tableau de définitions et double bloc d'émargement (Fidélité : 98% A+).
  - `10-event-ticket.html` : Billet d'événement et pass conférence VIP avec souche de contrôle détachable (`border-style: dashed`), code-barres vectoriel SVG, matrice QR Code SVG et grille d'accès (Fidélité : 90% A).
- **Stress-Test Volumique Grand Livre Comptable (`demo/templates/11-heavy-financial-ledger.html`)** :
  - Document financier dense de **~208 KB de DOM** comportant plus de 500 écritures comptables réparties sur 12 mois et 5 journaux.
  - Conversion complète en **~410 ms** produisant un PDF vectoriel compact de **99.5 KB** avec **97% de fidélité (A+)**.
  - Ajout du script utilitaire `scripts/generate-heavy-template.ts` pour générer et régénérer le jeu de données comptables.
- **Infrastructure de Démo & GitHub Pages** :
  - `scripts/build-demo.ts` : pipeline étendu à 11 templates avec audit de fidélité automatique (`verifyRenderingQuality`).
  - `demo/site/index.html` & `demo/site/app.js` : prise en charge des 11 onglets de démonstration avec prévisualisation scindée (HTML / Code / PDF) et affichage en temps réel des notes de fidélité.
  - `demo/site/styles.css` : barre de navigation optimisée avec scrollbar discrète et espacement réactif.

## [2.2.0] - 2026-09-07

### 🌐 Network & Security
- **Allowed Local IPs for Remote CSS (`allowedLocalIps` / `allowedCssIps`)**:
  - Support for loading external stylesheets (`<link rel="stylesheet">`, `@import url(...)`, and `options.css`) from planned local or intranet IP addresses.
  - Comprehensive matching support: exact IP addresses (`192.168.1.50`), CIDR subnets (`192.168.1.0/24`, `10.0.0.0/8`), and wildcards (`192.168.1.*`, `*.corp.local`, `*`).
  - Preserves strict SSRF defense by blocking unauthorized private IP ranges and cloud metadata endpoints.

### 📝 Native Node.js Multi-Level Logging
- **Zero-Dependency Native Logger (`src/core/logger.ts`)**:
  - 100% native implementation relying solely on Node.js standard runtime APIs (`process.stdout`, `process.stderr`, `node:fs`).
  - Configurable log levels: `ERROR`, `WARN`, `INFO`, `DEBUG` via `logLevel` and `verbose` options.
  - Colorized ANSI terminal output:
    - **ERROR** (Red): PDF generation and compilation errors (`Echec de construction du pdf : ...`).
    - **WARN** (Orange): CSS loading and network issues (`Erreur de chargement du CSS : ...`).
    - **INFO** (Green): Generation task lifecycle (start, completion, elapsed time).
    - **DEBUG** (Blue): Diagnostic metadata including CSS source origins, HTML character/byte sizes, and rendering phase timings.
  - File logging support (`logFile` option): Concurrently appends uncolored, clean log lines with ISO-8601 timestamps to a specified file path, with automatic parent directory creation.
  - Silent by default when verbose mode is inactive to preserve performance and clean console output.

### 🎨 CSS Loading & Error Resilience
- **Graceful CSS Error Tolerance**: External stylesheet retrieval failures log an orange `WARN` and proceed with PDF generation instead of crashing.
- **Strict CSS Flag (`strictCss: true`)**: Optional setting to re-enable strict failure mode when external stylesheets fail to load.
- **Concurrent Resource Downloading**: `<link rel="stylesheet">` tags and remote `@font-face` entries are fetched in parallel with `Promise.all`.
- **Recursive `@import` Resolution**: Supports nested `@import url(...)` directives with recursion depth limits to prevent circular loops.

### 🧪 Tests & Quality
- **Expanded Test Suite**: Reached **159 automated unit and integration tests** (33 suites) passing with **95.48% total code coverage** (100% coverage on `src/core/logger.ts`).
- **Manual Test Suite**: 47/47 functional tests passing.
- **Typecheck & Lint**: Fully compliant with TypeScript and Oxlint rules.

## [2.1.0] - 2026-09-06

### ⚡ Performance & Optimization Pipeline
- **Elimination of Double-Rendering (OPT-14)**: Added `estimateElementHeightFn` to pre-calculate element heights, rendering backgrounds and borders beforehand without re-emitting child nodes in flex/grid layouts.
- **Single-Pass Table Pipeline & Memoization (OPT-15)**: Unified column and row measurement into a single pass, memoized `textHeight`, `hasComplexChildren`, and `badgeTag` in `CellData`, and hoisted line/section CSS parsing.
- **String Style Cache & Direct Numeric Parsing (OPT-16)**: Added LRU `_parsedStringStyleCache` for identical `style="..."` attributes and eliminated regex evaluations in favor of fast native `parseFloat`.
- **LRU CSS Rules Memoization (OPT-17)**: Integrated LRU memoization for `parseCssRules`, `parsePageRule`, and `parseFontFaces` with early exit on documents without CSS rules.
- **Compact Key Typography Cache (OPT-18)**: Optimized font cache keys with compact hashing and O(1) eviction to avoid thrashing under heavy loads.
- **Fast-Path Plain-Text Headers/Footers (OPT-19)**: Direct plain-text rendering short-circuiting Cheerio parsing in `renderHeaderFooterContent`, with cached immutable `PageLayout` instances.
- **True Zero-Copy IPC Transfers (OPT-20)**: Directly transferred underlying `ArrayBuffer` without intermediate `.slice()` byte duplication.

### 🛡️ Hardening, Stability & Security
- **SSRF Shield & Path Traversal Guards**: Preventative blocking of private IP ranges, cloud metadata endpoints (AWS, GCP, Azure), and workspace boundary restrictions (`process.cwd()`).
- **Transferable IPC Buffers & Memory Limits**: Regulated worker queue concurrency (`maxWorkers * 2`) and strict memory quotas.

### 🧪 CI/CD, Quality & Developer Experience
- **Extended Test Suite**: Added 133 automated unit and integration tests across 29 test suites reaching **94.8% line coverage** (and >85% per module).
- **Automated CI/CD Pipeline**: GitHub Actions workflows for TypeScript typechecking, Oxlint linting, and automated test coverage on Node.js 22.
- **Semantic Pull Request Validation**: Conventional Commit enforcement with `@commitlint/cli` and `amannn/action-semantic-pull-request`.
- **Automated Dependency Management**: Dependabot configuration with monthly grouped updates for `npm` and `github-actions`.
- **Release Automation**: Integration of `googleapis/release-please-action` for automated SemVer release management.
- **Documentation**: Comprehensive architecture, benchmarking, and CI/CD guides (`docs/architecture.md`, `docs/benchmark.md`, `docs/optimisation.md`, `docs/ci-cd.md`).

## [2.0.0] - 2026-09-05


### Features
- Support for inline and external CSS styling (`line-height`, `letter-spacing`, `text-decoration`).
- Advanced table rendering support including `thead`/`tbody`, borders, padding, `colspan`, and `rowspan`.
- Dynamic header & footer support with `@page` pseudo-selectors and multi-zone layout.
- Support for SVG vector graphics and custom `@font-face` resolution (local files and data URIs).
- High performance Worker Pool execution architecture for multi-page PDF generation.
