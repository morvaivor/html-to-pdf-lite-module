# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) or [Release Please](https://github.com/googleapis/release-please) for automated commit specifications.

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
