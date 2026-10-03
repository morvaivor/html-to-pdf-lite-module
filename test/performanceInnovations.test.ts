import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { ensurePdfKitAccelerator, renderHtmlToPdf } from '../src/index.js';
import { LruCache } from '../src/core/lruCache.js';
import { parseInlineStyle } from '../src/core/cacheManager.js';
import { applyCssToElements, buildCssRuleIndex, parseCssRules } from '../src/cssParser.js';
import { renderSampleHashes } from './fixtures/acceleratorSamples.js';

const samplesScript = fileURLToPath(new URL('./fixtures/acceleratorSamples.ts', import.meta.url));

/** Reference implementation of applyCssToElements before the single-pass rewrite (v2.6.1). */
function legacyApplyCssToElements($: CheerioAPI, css: string): void {
  const rules = parseCssRules(css);
  if (rules.length === 0) return;
  $('[style]').each((_i, element) => {
    if (element.type === 'tag' && element.attribs?.style && !element.attribs['data-orig-style']) {
      element.attribs['data-orig-style'] = element.attribs.style;
    }
  });
  const index = buildCssRuleIndex(rules);
  const elementMatches = new Map<Element, Map<number, string>>();
  const addMatch = (el: Element, order: number, styleString: string) => {
    let map = elementMatches.get(el);
    if (!map) {
      map = new Map<number, string>();
      elementMatches.set(el, map);
    }
    map.set(order, styleString);
  };
  for (const c of index.complex) {
    const cleanSel = c.selector.trim();
    if (!cleanSel) continue;
    const applyComplex = (elements: Cheerio<any>) => {
      elements.each((_i: number, element: any) => {
        if (element.type === 'tag') addMatch(element as Element, c.order, c.styleString);
      });
    };
    try {
      applyComplex($(cleanSel));
    } catch {
      try {
        const fallbackSel = cleanSel
          .replace(/\[.*?\]/g, '')
          .replace(/:.*?(?=[ ,{]|$)/g, '')
          .trim();
        if (fallbackSel) applyComplex($(fallbackSel));
      } catch {
        // Skip unsupported selectors
      }
    }
  }
  $('*').each((_i, element) => {
    if (element.type !== 'tag') return;
    const el = element as Element;
    const tagName = el.name ? el.name.toLowerCase() : '';
    const id = el.attribs?.id;
    const classAttr = el.attribs?.class;
    if (tagName) for (const r of index.byTag.get(tagName) ?? []) addMatch(el, r.order, r.styleString);
    if (id) {
      for (const r of index.byId.get(id) ?? []) {
        if (!r.tagName || r.tagName === tagName) addMatch(el, r.order, r.styleString);
      }
    }
    if (classAttr) {
      const classes = classAttr.split(/\s+/).filter(Boolean);
      for (const cls of classes) {
        for (const r of index.byClass.get(cls) ?? []) {
          if (r.tagName && r.tagName !== tagName) continue;
          if (r.extraClasses && !r.extraClasses.every((c) => classes.includes(c))) continue;
          addMatch(el, r.order, r.styleString);
        }
      }
    }
  });
  for (const [el, matches] of elementMatches) {
    const sortedOrders = Array.from(matches.keys()).sort((a, b) => a - b);
    const combinedStyle = sortedOrders.map((o) => matches.get(o)!).join('; ');
    if (combinedStyle) {
      const current = el.attribs?.style || '';
      el.attribs.style = current ? current + '; ' + combinedStyle : combinedStyle;
    }
  }
  $('[data-orig-style]').each((_i, element) => {
    if (element.type === 'tag' && element.attribs?.['data-orig-style']) {
      const orig = element.attribs['data-orig-style'];
      const current = element.attribs.style || '';
      element.attribs.style = current ? current + '; ' + orig : orig;
      delete element.attribs['data-orig-style'];
    }
  });
}

function snapshotStyles($: CheerioAPI): Array<{ tag: string; style?: string; orig?: string; parsed: object }> {
  return $('*')
    .toArray()
    .filter((el): el is Element => el.type === 'tag')
    .map((el) => ({
      tag: el.name,
      style: el.attribs['style'],
      orig: el.attribs['data-orig-style'],
      parsed: { ...parseInlineStyle(el) },
    }));
}

/** Minimal 1×1 RGB PNG (no alpha channel, so PDFKit embeds it synchronously). */
function rgbPng(r: number, g: number, b: number): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, r, g, b]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const countOccurrences = (pdf: Buffer, needle: string): number => pdf.toString('latin1').split(needle).length - 1;

describe('Performance innovations', () => {
  describe('PDFKit acceleration layer', () => {
    test('is active for the audited PDFKit version', () => {
      const status = ensurePdfKitAccelerator();
      assert.equal(status.enabled, true, status.reason);
      assert.equal(status.fontMetrics, true, status.reason);
      assert.equal(status.colorCache, true, status.reason);
      assert.equal(status.streamCoalescing, true, status.reason);
    });

    test('produces byte-identical PDFs to stock PDFKit (PDF_LITE_ACCEL=off)', async () => {
      const accelerated = await renderSampleHashes();
      const child = spawnSync(process.execPath, ['--import', 'tsx', samplesScript], {
        env: { ...process.env, PDF_LITE_ACCEL: 'off' },
        encoding: 'utf-8',
        maxBuffer: 16 * 1024 * 1024,
      });
      assert.equal(child.status, 0, child.stderr);
      const stock = JSON.parse(child.stdout.trim().split('\n').pop() ?? '{}') as {
        accelerator: { enabled: boolean };
        hashes: Record<string, string>;
      };
      assert.equal(stock.accelerator.enabled, false, 'the reference run must use stock PDFKit');
      assert.equal(Object.keys(stock.hashes).length, Object.keys(accelerated).length);
      assert.deepEqual(accelerated, stock.hashes);
    });
  });

  describe('LruCache', () => {
    test('matches a reference LRU under random operations', () => {
      const capacity = 7;
      const cache = new LruCache<number, number>(capacity);
      let reference: Array<[number, number]> = []; // least → most recently used
      let seed = 42;
      const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

      for (let step = 0; step < 20000; step++) {
        const key = Math.floor(random() * 12);
        const op = random();
        if (op < 0.45) {
          const found = reference.find(([k]) => k === key);
          if (found) reference = [...reference.filter(([k]) => k !== key), found];
          assert.equal(cache.get(key), found?.[1]);
        } else if (op < 0.9) {
          const value = step;
          reference = reference.filter(([k]) => k !== key);
          if (reference.length >= capacity) reference.shift();
          reference.push([key, value]);
          cache.set(key, value);
        } else {
          const existed = reference.some(([k]) => k === key);
          reference = reference.filter(([k]) => k !== key);
          assert.equal(cache.delete(key), existed);
        }
        assert.equal(cache.size, reference.length);
      }
      assert.deepEqual(Array.from(cache.entries()), reference);
      assert.deepEqual(
        Array.from(cache.keys()),
        reference.map(([k]) => k),
      );
    });
  });

  describe('Single-pass CSS application', () => {
    const cases: Array<{ name: string; html: string; css: string }> = [
      {
        name: 'indexed, compound, duplicate and complex selectors with inline styles',
        html: `<div id="main" class="card dark"><h1 class="title" style="color: blue">T</h1>
          <p class="intro lead">A <a href="#">link</a></p><ul><li>1</li><li style="margin: 2px">2</li></ul>
          <span style="">empty</span><table><tr><td class="num">1</td></tr></table></div>`,
        css: `div { margin: 0; } #main { padding: 4px; } .card.dark { background-color: #eee; }
          h1, .title { font-size: 20px; } p.intro { color: #333; } div p { line-height: 1.4; }
          ul > li { margin-left: 8px; } a:hover { color: red; } [>>bad] { color: red; }
          table td.num { text-align: right; } .lead { font-weight: bold; }`,
      },
      {
        name: 'pre-existing data-orig-style attributes',
        html: `<p data-orig-style="color: red">a</p><p style="color: blue" data-orig-style="color: green">b</p>
          <p style="color: #111" data-orig-style="">c</p><p data-orig-style="">d</p>`,
        css: 'p { font-size: 11px; }',
      },
      {
        name: 'complex selectors observing the transient data-orig-style attribute',
        html: '<div><p style="color: blue">x</p><p>y</p></div>',
        css: '[data-orig-style] { font-weight: bold; } div [DATA-ORIG-STYLE] { font-size: 9px; } p { margin: 1px; }',
      },
      {
        name: 'svg subtree and repeated identical rows',
        html: `<svg width="10" height="10"><rect class="shape" width="10" height="10"/></svg>
          ${'<tr class="row"><td class="c" style="padding: 2px">v</td></tr>'.repeat(5)}`,
        css: '.shape { fill: red; } .row .c { color: #222; } td { font-size: 9px; }',
      },
    ];

    for (const { name, html, css } of cases) {
      test(`matches the legacy multi-pass algorithm: ${name}`, () => {
        const legacy = cheerio.load(html);
        legacyApplyCssToElements(legacy, css);
        const current = cheerio.load(html);
        applyCssToElements(current, css);
        assert.deepEqual(snapshotStyles(current), snapshotStyles(legacy));
      });
    }
  });

  describe('Rendering memory optimizations', () => {
    test('repeated images share a single XObject', async () => {
      const logo = rgbPng(200, 30, 30);
      const other = rgbPng(10, 120, 250);
      const html = `<div>${`<img src="${logo}" width="20" height="20" />`.repeat(5)}<img src="${other}" width="20" /></div>`;
      const pdf = await renderHtmlToPdf(html, { gpu: false });
      assert.equal(countOccurrences(pdf, '/Subtype /Image'), 2, 'one XObject per distinct image source');
    });

    test('renders long documents with and without page-dependent zones', async () => {
      const body = '<p>Paragraph repeated to span several pages.</p>'.repeat(150);
      const streamed = await renderHtmlToPdf(body, { gpu: false });
      const buffered = await renderHtmlToPdf(body, { gpu: false, footer: 'Page {page}/{totalPages}' });
      assert.ok(countOccurrences(streamed, '/Type /Page\n') > 1);
      assert.ok(countOccurrences(buffered, '/Type /Page\n') > 1);
    });
  });
});
