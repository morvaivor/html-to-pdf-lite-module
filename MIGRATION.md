# Migration Guide — v1.x → v2.0

## Overview

Version 2.0 migrates the entire codebase from JavaScript to **TypeScript** with the **OXC (JavaScript Oxidation Compiler)** toolchain. The public API remains identical — this is a tooling and type-safety upgrade with embedded security hardening.

---

## What Changed

### 🔧 TypeScript & OXC Stack

| Before (v1) | After (v2) |
|:---|:---|
| Plain JavaScript (`.js`) | TypeScript (`.ts`) source |
| No type checking at build time | `tsc --noEmit` strict type verification |
| `oxlint` (syntax lint only) | `oxlint` with TypeScript + Import + Unicorn plugins |
| No formatter | `oxfmt` (Prettier-compatible, 30× faster) |
| No build step — source shipped directly | `tsdown` (OXC-powered) → `dist/*.js` + `dist/*.d.ts` |
| Jest configured but unused | Jest removed — `node:test` native runner only |

### 📦 Package Distribution

| Before (v1) | After (v2) |
|:---|:---|
| `"main": "src/index.js"` | `"main": "dist/index.js"` |
| No `exports` field | Conditional `exports` with types |
| No `types` field | `"types": "dist/index.d.ts"` |
| No `engines` field | `"engines": { "node": ">=18.18.0" }` |
| No `files` field — entire repo published | `"files": ["dist", "README.md", "LICENSE"]` |
| No `LICENSE` file | MIT `LICENSE` file added |
| ESM source consumed directly | ESM compiled output with declaration files |

### 🔒 Security Fixes

| Vulnerability | Severity | Fix |
|:---|:---|:---|
| **Path Traversal** in image loading — `readFileSync()` on arbitrary paths | 🔴 Critical | Strict path resolution to `process.cwd()` only; `else` branch removed |
| **SSRF** — `fetch()` with no URL validation (images & fonts) | 🔴 Critical | New `validateRemoteUrl()` blocks private IPs, cloud metadata endpoints, non-HTTP protocols |
| **No size limit** on remote downloads | 🟠 High | `MAX_RESOURCE_SIZE` (50 MB) enforced on all remote fetches |
| **No timeout** on `fetch()` calls | 🟠 High | `AbortSignal.timeout(30_000)` on all network requests |
| **Unbounded `data:` URIs** | 🟡 Medium | `MAX_DATA_URI_SIZE` (10 MB) enforced |
| **`fs`/`path` imports without `node:` prefix** | 🟡 Medium | All Node.js built-in imports use `node:` protocol |

### ✨ TypeScript Patterns Introduced

- **`AsyncDisposable`** — `PdfGenerator` and `WorkerPool` implement `Symbol.asyncDispose` for automatic cleanup:
  ```typescript
  await using generator = createPdfGenerator({ useWorkerPool: true });
  const pdf = await generator.generate('<h1>Hello</h1>');
  // Worker pool automatically terminated when generator goes out of scope
  ```
- **Discriminated unions** for worker message types (compile-time exhaustiveness)
- **Readonly properties** on immutable value objects (`PageLayout`, config)
- **Strategy Pattern** with typed `Map<string, ElementRenderer>` registry
- **Strict null checks** via `noUncheckedIndexedAccess`

---

## Migration Guide for Consumers

### If you import the package by name (most common)

```typescript
// ✅ Works identically in v1 and v2
import { PdfGenerator, createPdfGenerator } from 'pdf-generator';

const gen = new PdfGenerator({ useWorkerPool: true });
const pdf = await gen.generate('<h1>Hello World</h1>');
```

**No changes required.** The public API is 100% backward compatible.

### If you import internal modules by path

```javascript
// ❌ v1 — importing source files directly (no longer works)
import { renderHtmlToPdf } from 'pdf-generator/src/htmlRenderer.js';

// ✅ v2 — import from the package entry point
import { PdfGenerator } from 'pdf-generator';
```

Internal modules are no longer part of the public API surface. Use the documented `PdfGenerator` class and `createPdfGenerator()` factory.

### TypeScript consumers — first-class types

v1 shipped a separate `types.d.ts` declaration file alongside the source. v2 generates declarations directly from the TypeScript source:

```typescript
// ✅ Types are auto-discovered — no separate import needed
import type { PdfGeneratorConfig, PdfGenerateOptions, PaperFormat } from 'pdf-generator';
```

New types available in v2:
- `PaperFormat` — `'A3' | 'A4' | 'A5' | 'Letter' | 'Legal'`
- `Orientation` — `'portrait' | 'landscape'`
- `MarginOptions`, `WorkerPoolStats`, `PdfGeneratorConfig`, `PdfGenerateOptions`

### Node.js version requirement

v2 requires **Node.js ≥ 18.18.0** (documented via `engines` field).

This was already the implicit minimum in v1 (due to global `fetch()` and `availableParallelism()`), but is now explicitly enforced.

### `await using` support (Node.js ≥ 22)

If you're on Node 22+, you can use the new `AsyncDisposable` protocol:

```typescript
// Automatic cleanup — no need to call terminateWorkerPool()
await using gen = createPdfGenerator({ useWorkerPool: true });
const pdf = await gen.generate(html);
// gen.terminateWorkerPool() called automatically here
```

### Security — behavioral changes

If your HTML or CSS references **private/internal network URLs**, they will now be **blocked by default**:

```html
<!-- ❌ Blocked in v2 (SSRF protection) -->
<img src="http://192.168.1.100/internal-image.png">
<img src="http://169.254.169.254/latest/meta-data/">
```

```css
/* ❌ Blocked in v2 */
@font-face {
  font-family: 'Internal';
  src: url(http://10.0.0.5/fonts/secret.ttf);
}
```

If your images/fonts are hosted on a local network **intentionally**, you will need to host them on a public URL or embed them as `data:` URIs (subject to 10 MB limit).

Resources loaded via `file://` path are restricted to the current working directory (`process.cwd()`).

---

## Changelog

### v2.0.0

#### 🔧 Tooling
- **CHANGED**: Entire codebase migrated from JavaScript to TypeScript
- **CHANGED**: Build pipeline switched from direct source to `tsdown` (OXC-powered)
- **CHANGED**: Linting upgraded with `oxlint` TypeScript, Import, and Unicorn plugins
- **ADDED**: `oxfmt` code formatter
- **ADDED**: Strict `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `isolatedDeclarations`)
- **ADDED**: `engines` field requiring Node.js ≥ 18.18.0
- **ADDED**: MIT `LICENSE` file
- **REMOVED**: Jest and ts-jest (unused — project uses `node:test`)

#### 📦 Distribution
- **CHANGED**: Package entry point from `src/index.js` to `dist/index.js`
- **ADDED**: `exports` field with conditional type resolution
- **ADDED**: `types` field pointing to generated `.d.ts`
- **ADDED**: `files` field for clean npm publish

#### 🔒 Security
- **FIXED**: Path traversal vulnerability in image loading (CVE severity: Critical)
- **FIXED**: SSRF vulnerability in image and font fetching (CVE severity: Critical)
- **ADDED**: Network request timeout (30s) and size limits (50 MB remote, 10 MB data URI)
- **ADDED**: `node:` protocol prefix on all Node.js built-in imports

#### ✨ Features
- **ADDED**: `AsyncDisposable` support (`await using`) on `PdfGenerator` and `WorkerPool`
- **ADDED**: Exported TypeScript types (`PaperFormat`, `Orientation`, etc.)
- **ADDED**: Full `.d.ts` declaration files generated from source

#### 🐛 Fixes
- No functional changes to the rendering pipeline
