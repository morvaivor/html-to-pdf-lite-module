# HTML-to-PDF Lite Module — Concrete Optimisation Patch Plan

## Objective

Improve throughput, latency, and memory behaviour without changing PDF output semantics.

The work should be split into small, independently benchmarkable patches. Each patch should include:

1. implementation,
2. focused regression tests,
3. benchmark before/after,
4. no unrelated refactoring.

The priority order below is based on expected impact and implementation risk.

---

## Patch 01 — Fix and upgrade `TextMeasureCache`

**Priority:** P0  
**Risk:** Low  
**Expected impact:** Medium CPU reduction + correctness fix

### Problem

The current cache key for long strings only includes the string length and a prefix. Different strings can therefore map to the same cached measurement.

The cache also behaves more like FIFO than true LRU because a cache hit does not refresh the entry.

### Changes

Update the cache to:

```ts
type TextMeasureKey = string;
```

Build the key from the complete text:

```ts
const key =
  `${fontFamily}|${fontSize}|${maxWidth}|` +
  `${effectiveLineGap}|${text}`;
```

On cache hit:

```ts
const value = cache.get(key);

if (value !== undefined) {
  cache.delete(key);
  cache.set(key, value);
  return value;
}
```

Keep the cache bounded.

### Tests

Add tests proving:

* two same-length strings with different content never collide;
* repeated access promotes an entry;
* oldest unused entry is evicted;
* measurement result remains identical with/without caching.

### Benchmark

Measure:

* repeated paragraphs;
* long paragraphs;
* documents with many unique strings.

---

## Patch 02 — Replace wholesale cache clearing with reusable LRU

**Priority:** P0  
**Risk:** Low  
**Expected impact:** Better cache hit rate and more stable latency

### Problem

Several caches use:

```ts
if (cache.size >= MAX) {
  cache.clear();
}
```

This creates periodic cache-thrashing.

### Changes

Create:

```ts
src/core/lruCache.ts
```

API:

```ts
class LruCache<K, V> {
  constructor(maxSize: number);

  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  get size(): number;
}
```

Use it for:

* `TextMeasureCache`;
* parsed string styles;
* CSS-related bounded caches;
* any future asset cache.

### Tests

Verify:

* max size is never exceeded;
* `get()` refreshes recency;
* least-recently-used entry is evicted.

### Benchmark

Compare cache hit rate and total render time against the current clear-all behaviour.

---

## Patch 03 — Add indexed CSS selector matching

**Priority:** P0  
**Risk:** Medium  
**Expected impact:** Potentially the largest CPU improvement

### Problem

CSS rules are currently applied by repeatedly querying the DOM for each rule.

The effective cost grows with both:

```text
number of CSS rules
×
selector matching work
```

### Target architecture

Compile rules once:

```text
CSS rules
   ↓
selector classification
   ↓
indexes
   ├── id
   ├── class
   ├── tag
   └── complex selectors
```

For each element, collect likely matching rules from the indexes.

### Fast-path selectors

Initially optimise:

```css
#id
.class
tag
tag.class
tag#id
```

Do not attempt to optimise every CSS selector in the first patch.

### Compatibility path

Complex selectors continue through the existing selector engine.

Example:

```text
simple selector
   → indexed lookup

complex selector
   → existing Cheerio matching
```

### Changes

Introduce something similar to:

```ts
interface CssRuleIndex {
  byId: Map<string, CssRule[]>;
  byClass: Map<string, CssRule[]>;
  byTag: Map<string, CssRule[]>;
  complex: CssRule[];
}
```

Then traverse the DOM once and assemble candidate rules.

### Tests

Build a selector-equivalence suite covering:

* IDs;
* classes;
* tag selectors;
* descendant selectors;
* combined selectors;
* selector specificity;
* source-order precedence;
* `!important`.

For every test document, compare output against the existing matcher.

### Benchmark

Add:

* 100 rules / 1,000 elements;
* 500 rules / 5,000 elements;
* repeated classes;
* large generated HTML.

Success criterion:

```text
No output differences
+
lower CSS-processing CPU time
```

---

## Patch 04 — Introduce shared cross-PDF asset caching

**Priority:** P0  
**Risk:** Medium  
**Expected impact:** High throughput improvement for repeated assets

### Problem

Font/image caches currently live at PDF-render scope, so every request can reload identical resources.

### New component

Create:

```ts
src/core/assetCache.ts
```

with separate bounded caches:

```ts
images
fonts
```

### Important feature: in-flight coalescing

Do not merely cache completed resources.

Also track currently-loading resources:

```ts
Map<string, Promise<Buffer>>
```

Example:

```text
request A ─┐
request B ─┼─→ same resource URL
request C ─┘       ↓
              one fetch
```

### API

Conceptually:

```ts
getImage(
  key: string,
  loader: () => Promise<Buffer>
): Promise<Buffer>
```

and:

```ts
getFont(
  key: string,
  loader: () => Promise<Buffer>
): Promise<Buffer>
```

### Configuration

Expose limits such as:

```ts
assetCache.maxImages
assetCache.maxFonts
assetCache.maxBytes
```

Prefer byte-based bounding if practical.

### Safety

Cache keys must include all parameters that affect interpretation, not just the URL.

For example, font identity may need to include:

```text
URL
weight
style
variant
```

### Tests

Verify:

* repeated requests hit cache;
* concurrent requests share one Promise;
* rejected loads are removed from the in-flight map;
* eviction works;
* different font variants don't collide.

### Benchmark

Measure:

* 100 PDFs using one logo;
* 100 PDFs using the same fonts;
* concurrent requests for the same assets.

---

## Patch 05 — Optimise table coordinate calculation

**Priority:** P1  
**Risk:** Low  
**Expected impact:** Medium for large tables

### Problem

Cell positions repeatedly use `.slice()` + `.reduce()`.

This causes:

* temporary array allocations;
* repeated summation;
* unnecessary O(n) work for every cell.

### Changes

Precompute column prefix positions:

```ts
const columnX: number[] = new Array(columnCount + 1);

columnX[0] = left;

for (let i = 0; i < columnCount; i++) {
  columnX[i + 1] = columnX[i] + colWidths[i];
}
```

Then:

```ts
const x = columnX[cell.startCol];

const width =
  columnX[cell.startCol + cell.colspan] -
  columnX[cell.startCol];
```

Do the same for row heights where repeated cumulative calculations exist.

### Tests

Compare:

* colspan;
* rowspan;
* borders;
* page breaks;
* nested tables.

### Benchmark

At minimum:

```text
100 × 5
500 × 10
1000 × 10
1000 × 20
```

Track both render time and peak allocations.

---

## Patch 06 — Memoize `estimateElementHeight()`

**Priority:** P1  
**Risk:** Medium  
**Expected impact:** Medium/high for flex/grid-heavy documents

### Problem

Flex/grid layout estimates child heights and then renders children, potentially recalculating expensive layout information.

### Changes

Add a render-scoped memoization cache:

```ts
WeakMap<Element, LayoutMeasurement>
```

The cached measurement must include the inputs that affect the result.

At minimum:

```ts
width
font configuration
relevant style state
```

Do not memoize solely by DOM element if width-dependent layout can change.

### Better target

Gradually move toward a reusable measurement result:

```ts
interface LayoutMeasurement {
  width: number;
  height: number;
  children?: LayoutMeasurement[];
}
```

The first patch does not need to redesign the whole renderer.

### Tests

Verify no stale measurements when:

* available width changes;
* font changes;
* flex direction changes;
* wrapping changes.

### Benchmark

Create deeply nested:

* flex;
* grid;
* mixed flex + text;
* mixed flex + table.

Measure estimation CPU separately from total render time.

---

## Patch 07 — Replace font alias scans with direct lookup

**Priority:** P1  
**Risk:** Low  
**Expected impact:** Small/medium

### Problem

Font resolution repeatedly scans registered aliases.

### Changes

Build an index when fonts are registered:

```ts
Map<string, string>
```

Use a normalised key such as:

```text
family|weight|style
```

Then font resolution becomes an O(1)-style map lookup for common cases.

Keep the existing fallback behaviour for unusual aliases.

### Tests

Cover:

* normal fonts;
* bold;
* italic;
* bold + italic;
* aliases;
* fallback fonts;
* multiple font families.

### Benchmark

Measure documents with thousands of text runs.

---

## Patch 08 — Add worker-pool backpressure

**Priority:** P1  
**Risk:** Medium  
**Expected impact:** Better stability under overload

### Problem

The worker task queue is unbounded.

Under sustained load:

```text
requests
   ↓
workers saturated
   ↓
queue grows
   ↓
HTML/PDF state remains referenced
   ↓
memory grows
```

### Changes

Add:

```ts
maxQueueSize
```

When full, reject new work immediately.

Example:

```ts
class WorkerPoolBusyError extends Error {}
```

### Configuration

Possible defaults:

```ts
maxQueueSize = workerCount * 2
```

but make the value configurable.

### API behaviour

HTTP integrations should be able to map this to:

```text
429 / 503
```

depending on application semantics.

### Tests

Verify:

* queue fills;
* oldest/newest policy is deterministic;
* rejected work does not leak references;
* workers continue processing after rejection;
* shutdown drains or rejects predictably.

### Benchmark

Stress test:

```text
workers = 1
workers = 2
workers = 4
workers = 8
```

with queue saturation.

Track:

* RSS;
* queue depth;
* p50;
* p95;
* p99 latency.

---

## Patch 09 — Configurable warm-worker floor

**Priority:** P2  
**Risk:** Low  
**Expected impact:** Better cold latency

### Problem

Scaling from zero minimises idle memory but adds startup latency.

### Changes

Add:

```ts
minWorkers?: number
```

Examples:

```ts
minWorkers: 0
minWorkers: 1
minWorkers: 2
```

Start the minimum number during pool initialisation.

### Tests

Verify:

* zero-worker mode;
* one-worker mode;
* automatic scale-up;
* automatic scale-down;
* shutdown.

### Benchmark

Compare:

```text
cold request
warm request
bursty traffic
steady traffic
```

---

## Patch 10 — Add phase-level performance instrumentation

**Priority:** P1  
**Risk:** Low  
**Expected impact:** Enables future optimisation

### Problem

Whole-document benchmark numbers don't show which subsystem is responsible for regressions.

### Changes

Add optional instrumentation around:

```text
HTML parsing
CSS parsing
CSS application
font resolution
image loading
text measurement
layout
table layout
flex/grid layout
PDFKit output
worker IPC
```

Expose only when benchmarking/debugging:

```ts
performance: {
  profiling: false
}
```

### Output

Example:

```json
{
  "parse": 3.1,
  "css": 7.8,
  "layout": 12.4,
  "textMeasure": 9.2,
  "assets": 2.1,
  "pdfWrite": 4.0
}
```

This should not impose meaningful overhead when disabled.

---

## Patch 11 — Expand benchmark matrix

**Priority:** P1  
**Risk:** Low  
**Expected impact:** Prevents false optimisation conclusions

Add benchmark fixtures for:

### CSS

```text
100 rules / 1k nodes
500 rules / 5k nodes
```

### Typography

```text
1000 repeated paragraphs
1000 unique paragraphs
long wrapped text
```

### Assets

```text
100 repeated images
100 repeated fonts
concurrent same-asset requests
```

### Tables

```text
100 × 5
500 × 10
1000 × 10
1000 × 20
```

### Layout

```text
deep flex
deep grid
nested flex/grid
table inside flex
```

### Concurrency

```text
1 request
2
4
8
16
32
```

Record:

```text
throughput
p50
p95
p99
RSS
heap used
```

---

## Patch 12 — Regenerate benchmark documentation

**Priority:** P2  
**Risk:** Very low

The benchmark documentation should always identify:

```text
package version
git commit
Node.js version
OS
CPU
RAM
benchmark command
worker count
```

Do not label results with an old release version after implementation changes.

Generate the report from the benchmark output where possible rather than maintaining numbers manually.

---

## Recommended merge order

```text
PR 1
Patch 01 + Patch 02
Cache correctness + generic LRU

PR 2
Patch 03
Indexed CSS matching

PR 3
Patch 04
Cross-PDF asset cache

PR 4
Patch 05
Table prefix sums

PR 5
Patch 06
Layout measurement memoization

PR 6
Patch 07
Font lookup index

PR 7
Patch 08 + Patch 09
Worker backpressure + warm-worker configuration

PR 8
Patch 10 + Patch 11 + Patch 12
Instrumentation + benchmark matrix + documentation
```

This order deliberately puts correctness-safe infrastructure first, followed by the two changes most likely to produce substantial real-world CPU savings: CSS matching and cross-PDF asset reuse.

---

## Acceptance criteria

The optimisation work should not be considered complete based solely on a faster benchmark.

For each patch:

```text
Correctness
✓ Existing test suite passes
✓ New regression tests pass
✓ PDF output remains equivalent for affected cases

Performance
✓ Benchmark before/after recorded
✓ Improvement measured on representative workloads

Memory
✓ Peak RSS measured for concurrency tests
✓ No unbounded cache/queue growth

Compatibility
✓ Existing public API unchanged unless the change is explicitly configuration-only
```

### Target outcomes

A reasonable optimisation target is:

```text
CSS-heavy documents
→ materially lower CSS processing time

Repeated assets across requests
→ near-zero duplicate downloads after warm-up

Large tables
→ lower layout CPU and allocation rate

Flex/grid-heavy documents
→ fewer repeated height calculations

High concurrency
→ bounded memory and predictable overload behaviour

Small requests
→ configurable low-latency warm workers
```

The exact percentage improvement should be established experimentally rather than assumed in advance.

---

## Suggested implementation sequence inside the codebase

Start with these files/components:

```text
src/core/cacheManager.ts
src/core/fontManager.ts
src/cssParser.ts
src/renderers/tableRenderer.ts
src/renderers/flexGridRenderer.ts
src/renderers/registry.ts
src/workers/workerPool.ts
```

Add:

```text
src/core/lruCache.ts
src/core/assetCache.ts
```

Then extend the benchmark/test directories with fixture-driven performance cases.

The guiding rule throughout the work should be:

> optimise repeated work first, allocations second, and micro-operations last.
