import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { renderHtmlToPdf } from '../src/index.js';
import { parseInlineStyle } from '../src/core/cacheManager.js';
import {
  computedFontSize,
  parseFontSize,
  parseLength,
  parseLengthOrPercentage,
  parseLineHeight,
} from '../src/core/cssLength.js';
import { parsePageMargins } from '../src/cssParser.js';

function contentStreams(pdf: Buffer): string {
  let content = '';
  for (const match of pdf.toString('binary').matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
    try {
      content += zlib.inflateSync(Buffer.from(match[1] as string, 'binary')).toString('latin1');
    } catch {
      // Not a deflate stream
    }
  }
  return content;
}

/** Font sizes (Tf operands) and text x positions (Tm operands) drawn in a PDF. */
function textOperators(pdf: Buffer): { sizes: number[]; xs: number[] } {
  const content = contentStreams(pdf);
  return {
    sizes: [...content.matchAll(/\/F\d+ ([\d.]+) Tf/g)].map((match) => Number(match[1])),
    xs: [...content.matchAll(/1 0 0 1 ([\d.]+) [\d.]+ Tm/g)].map((match) => Number(match[1])),
  };
}

describe('CSS lengths in points (1in = 96px = 72pt)', () => {
  test('converts absolute units', () => {
    assert.equal(parseLength('10px'), 7.5);
    assert.equal(parseLength('12pt'), 12);
    assert.equal(parseLength('1pc'), 12);
    assert.equal(parseLength('1in'), 72);
    assert.ok(Math.abs((parseLength('2.54cm') as number) - 72) < 1e-9);
    assert.ok(Math.abs((parseLength('25.4mm') as number) - 72) < 1e-9);
    assert.equal(parseLength('0'), 0);
    assert.equal(parseLength('10'), 7.5, 'unitless numbers are CSS pixels, as in HTML attributes');
  });

  test('resolves relative units and leaves keywords to the caller', () => {
    assert.equal(parseLength('2em', 10), 20);
    assert.equal(parseLength('1.5rem'), 18);
    assert.equal(parseLength('auto'), undefined);
    assert.equal(parseLength('50%'), undefined);
    assert.equal(parseLengthOrPercentage('50%', 200), 100);
  });

  test('parses font sizes as absolute sizes or factors of the parent size', () => {
    assert.deepEqual(parseFontSize('16px'), { fontSize: 12 });
    assert.deepEqual(parseFontSize('medium'), { fontSize: 12 });
    assert.deepEqual(parseFontSize('x-large'), { fontSize: 18 });
    assert.deepEqual(parseFontSize('1.5em'), { fontSizeScale: 1.5 });
    assert.deepEqual(parseFontSize('120%'), { fontSizeScale: 1.2 });
    assert.equal(computedFontSize(parseFontSize('smaller'), 12), 10);
  });

  test('parses line heights as multipliers of the font size', () => {
    assert.equal(parseLineHeight('1.35'), 1.35);
    assert.equal(parseLineHeight('150%'), 1.5);
    assert.equal(parseLineHeight('1.5em'), 1.5);
    assert.equal(parseLineHeight('18px', 12), 1.125);
    assert.equal(parseLineHeight('normal'), undefined);
  });

  test('parses declarations with units, keywords and !important', () => {
    const style = parseInlineStyle({
      attribs: { style: 'padding-right: 14px !important; border: 2px none red; border-top: thin solid #000' },
    });
    assert.equal(style.paddingRight, 10.5);
    assert.equal(style.borderWidth, 0, 'a `none` border has no width');
    assert.equal(style.borderTopWidth, 0.75);
    assert.equal(parseInlineStyle({ attribs: { style: 'font-size: 10pt; margin: 1em 2mm' } }).marginTop, 10);
  });
});

/** Text baselines (Tm y operands, PDF coordinates: y grows upwards). */
function textBaselines(pdf: Buffer): number[] {
  return [...contentStreams(pdf).matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/g)].map((match) => Number(match[1]));
}

describe('Vertical margins of adjacent blocks', () => {
  const secondBaseline = async (html: string): Promise<number> =>
    textBaselines(await renderHtmlToPdf(html, { gpu: false }))[1] as number;

  test('collapse to the larger margin instead of adding up', async () => {
    const collapsed = await secondBaseline('<p style="margin: 0 0 20px">A</p><p style="margin: 10px 0 0">B</p>');
    const bottomOnly = await secondBaseline('<p style="margin: 0 0 20px">A</p><p style="margin: 0">B</p>');
    const largerTop = await secondBaseline('<p style="margin: 0 0 20px">A</p><p style="margin: 30px 0 0">B</p>');
    assert.equal(collapsed, bottomOnly, 'max(20px, 10px) = 20px');
    assert.ok(Math.abs(bottomOnly - largerTop - 7.5) < 1e-6, 'max(20px, 30px) = 30px, 10px (7.5pt) lower');
  });

  test('keep the margins of a block of blocks, and do not collapse through text', async () => {
    const block = await secondBaseline('<p>A</p><div style="margin-top: 20px"><p>B</p></div>');
    const flat = await secondBaseline('<p>A</p><p style="margin-top: 20px">B</p>');
    assert.equal(block, flat);
  });
});

describe('Rendering with CSS units', () => {
  test('sizes headings relative to the parent font size, as the user-agent style sheet does', async () => {
    const html = '<body style="font-size: 10px"><h1>Titre</h1><h2>Sous-titre</h2><p>Texte</p></body>';
    const { sizes } = textOperators(await renderHtmlToPdf(html, { gpu: false }));
    assert.deepEqual(sizes, [15, 11.25, 7.5]);
  });

  test('uses the @page margins in points, unless the margin option sets them', async () => {
    const html = '<style>@page { margin: 40px 80px; }</style><p>Texte</p>';
    assert.deepEqual(textOperators(await renderHtmlToPdf(html, { gpu: false })).xs, [60]);
    const explicit = await renderHtmlToPdf(html, { gpu: false, margin: { left: 30 } });
    assert.deepEqual(textOperators(explicit).xs, [30]);
  });

  test('sizes images from their CSS width and height, which win over the HTML attributes', async () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const pdf = await renderHtmlToPdf(`<img src="${png}" width="400" height="400" style="width: 100px; height: 2cm">`, {
      gpu: false,
    });
    // PDFKit draws an image with the matrix [width 0 0 -height x y] just before painting its XObject.
    const [, width, height] = /([\d.]+) 0 0 -([\d.]+) [\d.]+ [\d.]+ cm\s+\/I\d+ Do/.exec(contentStreams(pdf)) ?? [];
    assert.equal(Number(width), 75);
    assert.ok(Math.abs(Number(height) - 56.6929) < 1e-3);
  });

  test('reads @page margin declarations, not those of the margin boxes', () => {
    const css = '@page { @top-left { content: "x"; margin: 99px; } margin: 10mm 20px; margin-bottom: 1in; }';
    const margins = parsePageMargins(css);
    assert.ok(margins);
    assert.ok(Math.abs((margins.top as number) - 28.3465) < 1e-3);
    assert.equal(margins.right, 15);
    assert.equal(margins.bottom, 72);
    assert.equal(margins.left, 15);
    assert.equal(parsePageMargins('@page { size: A4; }'), null);
  });
});
