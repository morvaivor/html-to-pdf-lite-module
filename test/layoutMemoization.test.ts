import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { estimateElementHeight, type LayoutMeasurementCache } from '../src/renderers/registry.js';
import { TextMeasureCache, DEFAULT_STYLE } from '../src/core/cacheManager.js';
import { createPdfGenerator } from '../src/index.js';

describe('Patch 06: Layout Measurement Memoization', () => {
  test('memoizes child height calculations and avoids redundant passes', () => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const textCache = new TextMeasureCache();
    const fontAliasSet = new Set<string>();
    const measurementCache: LayoutMeasurementCache = new WeakMap();

    const html = `<div style="padding: 10px;">
      <p>Paragraph one with repeated calculation.</p>
      <p>Paragraph two with repeated calculation.</p>
    </div>`;

    const $ = cheerio.load(html);
    const element = $('div')[0] as unknown as Element;

    const height1 = estimateElementHeight(doc, element, DEFAULT_STYLE, 400, textCache, fontAliasSet, measurementCache);
    const height2 = estimateElementHeight(doc, element, DEFAULT_STYLE, 400, textCache, fontAliasSet, measurementCache);

    assert.equal(height1, height2);
    assert.ok(height1 > 0);
    assert.ok(measurementCache.has(element), 'Element should be recorded in measurementCache');
  });

  test('re-estimates correctly when available width changes (no stale measurements)', () => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const textCache = new TextMeasureCache();
    const fontAliasSet = new Set<string>();
    const measurementCache: LayoutMeasurementCache = new WeakMap();

    const longText = 'Word '.repeat(80);
    const html = `<div><p>${longText}</p></div>`;
    const $ = cheerio.load(html);
    const element = $('div')[0] as unknown as Element;

    const heightWide = estimateElementHeight(
      doc,
      element,
      DEFAULT_STYLE,
      600,
      textCache,
      fontAliasSet,
      measurementCache,
    );
    const heightNarrow = estimateElementHeight(
      doc,
      element,
      DEFAULT_STYLE,
      200,
      textCache,
      fontAliasSet,
      measurementCache,
    );

    assert.ok(heightNarrow > heightWide, 'Narrow container must be taller due to word wrapping');
  });

  test('re-estimates correctly when font size or family changes', () => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const textCache = new TextMeasureCache();
    const fontAliasSet = new Set<string>();
    const measurementCache: LayoutMeasurementCache = new WeakMap();

    const $small = cheerio.load(
      `<div style="font-size: 10px;">Sample text to measure with multiple words to observe height differences</div>`,
    );
    const $large = cheerio.load(
      `<div style="font-size: 28px;">Sample text to measure with multiple words to observe height differences</div>`,
    );
    const elSmall = $small('div')[0] as unknown as Element;
    const elLarge = $large('div')[0] as unknown as Element;

    const heightSmall = estimateElementHeight(
      doc,
      elSmall,
      DEFAULT_STYLE,
      200,
      textCache,
      fontAliasSet,
      measurementCache,
    );
    const heightLarge = estimateElementHeight(
      doc,
      elLarge,
      DEFAULT_STYLE,
      200,
      textCache,
      fontAliasSet,
      measurementCache,
    );

    assert.ok(heightLarge > heightSmall, 'Larger font size must result in greater height');
  });

  test('renders complex nested flex and grid layout cleanly with memoization', async () => {
    const html = `
      <div style="display: flex; gap: 12px; padding: 10px; background-color: #f9f9f9;">
        <div style="width: 50%; padding: 8px; border: 1px solid #ddd;">
          <h3>Card 1</h3>
          <p>Description text for card 1 with several sentences to test wrap estimation.</p>
        </div>
        <div style="width: 50%; display: flex; flex-direction: column; gap: 6px;">
          <div style="background-color: #e0e0e0; padding: 6px;">Nested Box A</div>
          <div style="background-color: #d0d0d0; padding: 6px;">Nested Box B</div>
        </div>
      </div>
    `;

    const generator = createPdfGenerator();
    const buffer = await generator.generate(html);
    assert.ok(buffer instanceof Buffer);
    assert.ok(buffer.length > 500);
  });
});
