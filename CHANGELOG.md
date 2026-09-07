# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) or [Release Please](https://github.com/googleapis/release-please) for automated commit specifications.

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
