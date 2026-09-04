import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPdfGenerator } from '../src/index.js';
import { renderHtmlToPdf, PageLayout, TextMeasureCache } from '../src/htmlRenderer.js';
import {
  parseCssRules,
  applyCssToElements,
  parsePageRule,
  parseFontFaces,
  elementMatchesSelector,
  stripFontFaceBlocks,
} from '../src/cssParser.js';
import PDFDocument from 'pdfkit';
import * as cheerio from 'cheerio';

// =============================================
// CSS PARSER
// =============================================
describe('cssParser', () => {
  describe('parseCssRules', () => {
    test('returns empty for null/undefined/empty', () => {
      assert.deepEqual(parseCssRules(null), []);
      assert.deepEqual(parseCssRules(undefined), []);
      assert.deepEqual(parseCssRules(''), []);
    });

    test('parses element selector', () => {
      const r = parseCssRules('h1 { color: red; font-size: 24px; }');
      assert.equal(r.length, 1);
      assert.equal(r[0].selector, 'h1');
      assert.equal(r[0].properties.color, 'red');
    });

    test('parses class and ID selectors', () => {
      const r = parseCssRules('.highlight { color: #ff0000; } #hdr { font-weight: bold; }');
      assert.equal(r.length, 2);
    });

    test('strips @page and @font-face before parsing', () => {
      const css =
        '@page { @bottom-center { content: "P"; } } @font-face { font-family: T; src: url(t.ttf); } p { color: blue; }';
      const r = parseCssRules(css);
      assert.equal(r.length, 1);
      assert.equal(r[0].selector, 'p');
    });

    test('handles colons in values', () => {
      const r = parseCssRules('a { content: "http://x.com"; }');
      assert.ok(r[0].properties.content.includes('http'));
    });

    test('ignores empty declarations', () => {
      assert.deepEqual(parseCssRules('p { ; ; }'), []);
    });
  });

  describe('parseFontFaces', () => {
    test('returns empty for null/undefined', () => {
      assert.deepEqual(parseFontFaces(null), []);
      assert.deepEqual(parseFontFaces(''), []);
    });

    test('parses font-face with bold italic', () => {
      const css =
        "@font-face { font-family: 'MF'; src: url('http://x.com/f.ttf'); font-weight: bold; font-style: italic; }";
      const f = parseFontFaces(css);
      assert.equal(f.length, 1);
      assert.equal(f[0].bold, true);
      assert.equal(f[0].italic, true);
    });

    test('numeric weight >= 700 is bold', () => {
      const f = parseFontFaces('@font-face { font-family: T; src: url(t.ttf); font-weight: 700; }');
      assert.equal(f[0].bold, true);
    });

    test('defaults to normal weight/style', () => {
      const f = parseFontFaces('@font-face { font-family: T; src: url(t.ttf); }');
      assert.equal(f[0].bold, false);
      assert.equal(f[0].italic, false);
    });

    test('skips without family or url', () => {
      assert.equal(parseFontFaces('@font-face { font-family: T; }').length, 0);
      assert.equal(parseFontFaces('@font-face { src: url(t.ttf); }').length, 0);
    });
  });

  describe('elementMatchesSelector', () => {
    const el = (name, cls = '', id = '') => ({ name, attribs: { class: cls, id } });
    test('matches tag', () => {
      assert.equal(elementMatchesSelector(el('h1'), 'h1'), true);
      assert.equal(elementMatchesSelector(el('h1'), 'p'), false);
    });

    test('matches class', () => {
      assert.equal(elementMatchesSelector(el('p', 'red bold'), '.red'), true);
      assert.equal(elementMatchesSelector(el('p', 'red'), '.blue'), false);
    });

    test('matches id', () => {
      assert.equal(elementMatchesSelector(el('div', '', 'hdr'), '#hdr'), true);
      assert.equal(elementMatchesSelector(el('div', '', 'hdr'), '#ftr'), false);
    });

    test('matches grouped selectors', () => {
      assert.equal(elementMatchesSelector(el('h2'), 'h1, h2, h3'), true);
      assert.equal(elementMatchesSelector(el('p'), 'h1, h2'), false);
    });
  });

  describe('applyCssToElements', () => {
    test('no-op for null/empty', () => {
      const $ = cheerio.load('<p>T</p>');
      applyCssToElements($, '');
      applyCssToElements($, null);
      assert.equal($('p').attr('style'), undefined);
    });

    test('applies CSS as inline styles', () => {
      const $ = cheerio.load('<p>T</p>');
      applyCssToElements($, 'p { color: blue; }');
      assert.ok($('p').attr('style').includes('color: blue'));
    });

    test('preserves existing inline styles', () => {
      const $ = cheerio.load('<p style="color: red;">T</p>');
      applyCssToElements($, 'p { font-size: 14px; }');
      const s = $('p').attr('style');
      assert.ok(s.includes('color: red'));
      assert.ok(s.includes('font-size: 14px'));
    });

    test('handles invalid selectors gracefully', () => {
      const $ = cheerio.load('<p>T</p>');
      applyCssToElements($, '[>>bad] { color: red; }');
    });
  });

  describe('parsePageRule', () => {
    test('returns null for null/empty/no page', () => {
      assert.equal(parsePageRule(null), null);
      assert.equal(parsePageRule(''), null);
      assert.equal(parsePageRule('p { color: red; }'), null);
    });

    test('parses @page zones', () => {
      const z = parsePageRule('@page { @bottom-center { content: "P"; font-size: 10px; } }');
      assert.ok(z['bottom-center']);
      assert.equal(z['bottom-center'].content, '"P"');
    });

    test('parses all 6 zones', () => {
      const css =
        '@page { @top-left { content: "a"; } @top-center { content: "b"; } @top-right { content: "c"; } @bottom-left { content: "d"; } @bottom-center { content: "e"; } @bottom-right { content: "f"; } }';
      const z = parsePageRule(css);
      assert.equal(Object.keys(z).length, 6);
    });

    test('returns null for @page without zones', () => {
      assert.equal(parsePageRule('@page { margin: 0; }'), null);
    });
  });

  describe('stripFontFaceBlocks', () => {
    test('removes @font-face blocks', () => {
      const r = stripFontFaceBlocks('@font-face { font-family: T; } p { color: red; }');
      assert.ok(!r.includes('@font-face'));
      assert.ok(r.includes('p { color: red; }'));
    });
  });
});

// =============================================
// HTML RENDERER
// =============================================
describe('htmlRenderer', () => {
  test('throws for empty HTML', async () => {
    await assert.rejects(async () => renderHtmlToPdf(''), /non-empty string/);
    await assert.rejects(async () => renderHtmlToPdf(null));
  });

  test('generates valid PDF for simple HTML', async () => {
    const buf = await renderHtmlToPdf('<h1>Hello</h1>');
    assert.ok(buf instanceof Buffer);
    assert.ok(buf.toString('latin1').startsWith('%PDF'));
  });

  test('renders all heading levels', async () => {
    const buf = await renderHtmlToPdf('<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>');
    assert.ok(buf.length > 0);
  });

  test('renders inline elements span, a', async () => {
    const buf = await renderHtmlToPdf('<p><span style="color: #ff0000;">R</span> <a>link</a></p>');
    assert.ok(buf.length > 0);
  });

  test('renders br tags', async () => {
    const buf = await renderHtmlToPdf('<p>A</p><br><p>B</p>');
    assert.ok(buf.length > 0);
  });

  test('applies external CSS', async () => {
    const buf = await renderHtmlToPdf('<p>S</p>', { css: 'p { color: #0000ff; }' });
    assert.ok(buf.length > 0);
  });

  test('handles all inline CSS properties', async () => {
    const html =
      '<div style="color: #333; background-color: #eee; font-size: 14px; font-weight: bold; font-style: italic; font-family: Courier; border: 1px solid #000; border-color: #ff0000; border-width: 2px; padding: 10px; text-align: center;">All</div>';
    const buf = await renderHtmlToPdf(html);
    assert.ok(buf.length > 0);
  });

  test('color without # falls back to default', async () => {
    const buf = await renderHtmlToPdf('<p style="color: rgb(0,0,0);">T</p>');
    assert.ok(buf.length > 0);
  });

  test('background-color without # is undefined', async () => {
    const buf = await renderHtmlToPdf('<p style="background-color: blue;">T</p>');
    assert.ok(buf.length > 0);
  });

  test('custom format and orientation', async () => {
    const buf = await renderHtmlToPdf('<p>L</p>', {
      format: 'Letter',
      orientation: 'landscape',
      margin: { top: 50, bottom: 50, left: 40, right: 40 },
    });
    assert.ok(buf.length > 0);
  });

  test('table with borders, thead, tbody', async () => {
    const buf = await renderHtmlToPdf(
      '<table style="border: 1px solid #000000; padding: 5px;"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    );
    assert.ok(buf.length > 0);
  });

  test('table with colspan and rowspan', async () => {
    const buf = await renderHtmlToPdf(
      '<table style="border: 1px solid #000;"><tr><th colspan="2">H</th><th>C</th></tr><tr><td rowspan="2">S</td><td>B1</td><td>C1</td></tr><tr><td>B2</td><td>C2</td></tr></table>',
    );
    assert.ok(buf.length > 0);
  });

  test('nested tables', async () => {
    const buf = await renderHtmlToPdf(
      '<table style="border: 1px solid #000;"><tr><td><table style="border: 1px solid #00f;"><tr><td>N</td></tr></table></td></tr></table>',
    );
    assert.ok(buf.length > 0);
  });

  test('unordered and ordered lists', async () => {
    const buf = await renderHtmlToPdf('<ul><li>A</li><li>B</li></ul><ol><li>1</li><li>2</li></ol>');
    assert.ok(buf.length > 0);
  });

  test('nested lists', async () => {
    const buf = await renderHtmlToPdf('<ul><li>P<ul><li>C</li></ul></li></ul>');
    assert.ok(buf.length > 0);
  });

  test('image from data URI', async () => {
    const img =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFUlEQVR4nGNgOJFCGhrVMKph+GoAABn1LBB8AQh5AAAAAElFTkSuQmCC';
    const buf = await renderHtmlToPdf('<img src="' + img + '" width="50" height="50" />');
    assert.ok(buf.length > 0);
  });

  test('image without src is no-op', async () => {
    const buf = await renderHtmlToPdf('<p>B</p><img /><p>A</p>');
    assert.ok(buf.length > 0);
  });

  test('pagination multi-page', async () => {
    let html = '';
    for (let i = 0; i < 80; i++) html += '<p>Para ' + i + ' with longer content.</p>';
    const buf = await renderHtmlToPdf(html);
    assert.ok(buf.length > 2000);
  });

  test('header and footer with page/totalPages', async () => {
    let html = '';
    for (let i = 0; i < 30; i++) html += '<p>L ' + i + '</p>';
    const buf = await renderHtmlToPdf(html, {
      header: '<div style="font-size: 8px;">H</div>',
      footer: '<div style="font-size: 8px;">P {page}/{totalPages}</div>',
    });
    assert.ok(buf.length > 0);
  });

  test('@page with counter(page) only (single pass)', async () => {
    let html = '';
    for (let i = 0; i < 30; i++) html += '<p>L' + i + '</p>';
    const buf = await renderHtmlToPdf(html, {
      css: '@page { @bottom-center { content: "P " counter(page); font-size: 10px; } }',
    });
    assert.ok(buf.length > 0);
  });

  test('@page with counter(num-pages) triggers two-pass', async () => {
    let html = '';
    for (let i = 0; i < 30; i++) html += '<p>L' + i + '</p>';
    const buf = await renderHtmlToPdf(html, {
      css: '@page { @bottom-center { content: "P " counter(page) "/" counter(num-pages); font-size: 10px; } }',
    });
    assert.ok(buf.length > 0);
  });

  test('@page all 6 zones with styles', async () => {
    const buf = await renderHtmlToPdf('<p>C</p>', {
      css: '@page { @top-left { content: "TL"; font-size: 8px; color: #f00; font-weight: bold; font-style: italic; } @top-center { content: "TC"; font-size: 8px; } @top-right { content: "TR"; font-size: 8px; font-family: Courier; } @bottom-left { content: "BL"; font-size: 8px; } @bottom-center { content: "BC"; font-size: 8px; } @bottom-right { content: "BR"; font-size: 8px; } }',
    });
    assert.ok(buf.length > 0);
  });

  test('@page zones override header/footer', async () => {
    const buf = await renderHtmlToPdf('<p>C</p>', {
      header: '<div>H</div>',
      footer: '<div>F</div>',
      css: '@page { @top-left { content: "Z"; } }',
    });
    assert.ok(buf.length > 0);
  });

  test('text-only block elements', async () => {
    const buf = await renderHtmlToPdf('<div>Simple text</div>');
    assert.ok(buf.length > 0);
  });

  test('table with text-align center/right', async () => {
    const buf = await renderHtmlToPdf(
      '<table><tr><td style="text-align: center;">C</td><td style="text-align: right;">R</td><td>L</td></tr></table>',
    );
    assert.ok(buf.length > 0);
  });

  test('header/footer as plain text', async () => {
    const buf = await renderHtmlToPdf('<p>C</p>', { header: 'Plain header', footer: 'Plain footer' });
    assert.ok(buf.length > 0);
  });

  test('table with background-color on cells', async () => {
    const buf = await renderHtmlToPdf(
      '<table style="border: 1px solid #000;"><tr><td style="background-color: #eeffee;">BG</td></tr></table>',
    );
    assert.ok(buf.length > 0);
  });

  test('image with height-only scaling', async () => {
    const img =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFUlEQVR4nGNgOJFCGhrVMKph+GoAABn1LBB8AQh5AAAAAElFTkSuQmCC';
    const buf = await renderHtmlToPdf('<img src="' + img + '" height="100" />');
    assert.ok(buf.length > 0);
  });

  test('image with width-only scaling', async () => {
    const img =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFUlEQVR4nGNgOJFCGhrVMKph+GoAABn1LBB8AQh5AAAAAElFTkSuQmCC';
    const buf = await renderHtmlToPdf('<img src="' + img + '" width="100" />');
    assert.ok(buf.length > 0);
  });

  test('large image is resized to content width', async () => {
    const img =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFUlEQVR4nGNgOJFCGhrVMKph+GoAABn1LBB8AQh5AAAAAElFTkSuQmCC';
    const buf = await renderHtmlToPdf('<img src="' + img + '" width="2000" />');
    assert.ok(buf.length > 0);
  });

  test('list with styled items', async () => {
    const buf = await renderHtmlToPdf(
      '<ul><li style="color: #ff0000; font-weight: bold;">R</li><li style="font-style: italic;">I</li></ul>',
    );
    assert.ok(buf.length > 0);
  });
});

// =============================================
// OPTIMIZATION STRUCTURES
// =============================================
describe('PageLayout', () => {
  test('computes dimensions correctly', () => {
    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
    doc.addPage({ size: 'A4', margin: 0 });
    const l = new PageLayout(doc, {
      margin: { top: 20, bottom: 30, left: 25, right: 35 },
      _headerHeight: 15,
      _footerHeight: 10,
    });
    assert.equal(l.contentWidth, doc.page.width - 25 - 35);
    assert.equal(l.contentTop, 20 + 15);
    assert.equal(l.pageBottom, doc.page.height - 30 - 10);
  });

  test('uses defaults when options are missing', () => {
    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
    doc.addPage({ size: 'A4', margin: 0 });
    const l = new PageLayout(doc, {});
    assert.equal(l.leftMargin, 20);
    assert.equal(l.headerHeight, 0);
  });
});

describe('TextMeasureCache', () => {
  test('caches results', () => {
    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
    doc.addPage({ size: 'A4', margin: 0 });
    const c = new TextMeasureCache(100);
    const h1 = c.measure(doc, 'Hello', 'Helvetica', 12, 500);
    const h2 = c.measure(doc, 'Hello', 'Helvetica', 12, 500);
    assert.equal(h1, h2);
  });

  test('different inputs give different results', () => {
    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
    doc.addPage({ size: 'A4', margin: 0 });
    const c = new TextMeasureCache();
    const h1 = c.measure(doc, 'Short', 'Helvetica', 12, 500);
    const h2 = c.measure(doc, 'A much longer text that should definitely be taller', 'Helvetica', 12, 50);
    assert.ok(h2 > h1);
  });

  test('evicts when maxSize reached', () => {
    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
    doc.addPage({ size: 'A4', margin: 0 });
    const c = new TextMeasureCache(3);
    c.measure(doc, 't1', 'Helvetica', 12, 500);
    c.measure(doc, 't2', 'Helvetica', 12, 500);
    c.measure(doc, 't3', 'Helvetica', 12, 500);
    c.measure(doc, 't4', 'Helvetica', 12, 500);
    assert.ok(c.measure(doc, 't4', 'Helvetica', 12, 500) > 0);
  });

  test('clear empties cache', () => {
    const c = new TextMeasureCache();
    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
    doc.addPage({ size: 'A4', margin: 0 });
    c.measure(doc, 't', 'Helvetica', 12, 500);
    c.clear();
    assert.ok(c.measure(doc, 't', 'Helvetica', 12, 500) > 0);
  });
});

// =============================================
// PdfGenerator
// =============================================
describe('PdfGenerator', () => {
  test('createPdfGenerator returns instance', () => {
    const g = createPdfGenerator();
    assert.ok(g);
  });

  test('generates PDF with default config', async () => {
    const g = createPdfGenerator();
    const buf = await g.generate('<p>Default</p>');
    assert.ok(buf instanceof Buffer);
  });

  test('per-call options override global config', async () => {
    const g = createPdfGenerator({ defaultFormat: 'A4', css: 'p { color: #0000ff; }' });
    const buf = await g.generate('<p>T</p>', { format: 'Letter', css: 'p { color: #ff0000; }' });
    assert.ok(buf instanceof Buffer);
  });

  test('merges margin deeply', async () => {
    const g = createPdfGenerator({ defaultMargin: { top: 10, bottom: 10, left: 10, right: 10 } });
    const buf = await g.generate('<p>T</p>', { margin: { top: 50 } });
    assert.ok(buf instanceof Buffer);
  });

  test('supports global header/footer', async () => {
    const g = createPdfGenerator({
      header: '<div style="font-size: 8px;">H</div>',
      footer: '<div style="font-size: 8px;">F</div>',
    });
    const buf = await g.generate('<p>C</p>');
    assert.ok(buf instanceof Buffer);
  });
});

// =============================================
// HIGH-FIDELITY RENDERING TESTS
// =============================================
describe('High-Fidelity Rendering', () => {
  test('extracts and applies internal <style> blocks from HTML', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          .highlight { color: #1e40af; font-weight: bold; font-size: 16px; }
          .boxed { background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 10px 14px; }
        </style>
      </head>
      <body>
        <p class="highlight">Texte stylisé par classe</p>
        <div class="boxed">Citation ou chapo encadré</div>
      </body>
      </html>
    `;
    const buf = await renderHtmlToPdf(html);
    assert.ok(buf instanceof Buffer);
    assert.ok(buf.length > 0);
  });

  test('renders container with box decoration (background, borders, padding)', async () => {
    const html = `
      <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; padding: 10px 14px; margin: 12px 0;">
        <p style="color: #1e40af; font-style: italic;">Citation en exergue</p>
        <p style="text-align: right; color: #3b82f6;">— Auteur</p>
      </div>
    `;
    const buf = await renderHtmlToPdf(html);
    assert.ok(buf instanceof Buffer);
    assert.ok(buf.length > 0);
  });

  test('renders inline badge with adjacent metadata on same row', async () => {
    const html = `
      <div>
        <span style="background-color: #e0e7ff; color: #3730a3; padding: 4px 8px; font-weight: bold; display: inline-block;">BADGE</span>
        <span style="color: #64748b; margin-left: 10px;">Date de publication</span>
      </div>
    `;
    const buf = await renderHtmlToPdf(html);
    assert.ok(buf instanceof Buffer);
    assert.ok(buf.length > 0);
  });

  test('renders headings with border-bottom and text-transform', async () => {
    const html = `
      <h2 style="color: #1e3a8a; font-size: 17px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; text-transform: uppercase;">
        Titre de section souligné
      </h2>
    `;
    const buf = await renderHtmlToPdf(html);
    assert.ok(buf instanceof Buffer);
    assert.ok(buf.length > 0);
  });

  test('renders mixed inline text runs (bold and italic inside paragraph)', async () => {
    const html = `
      <p style="text-align: justify; line-height: 1.5;">
        Ceci est un texte <b>très important en gras</b> et une mention <i>en italique</i> dans un même paragraphe.
      </p>
    `;
    const buf = await renderHtmlToPdf(html);
    assert.ok(buf instanceof Buffer);
    assert.ok(buf.length > 0);
  });

  test('renders multi-column flex container (display: flex, flex-direction: row)', async () => {
    const html = `
      <div style="display: flex; flex-direction: row; gap: 12px; margin-bottom: 10px;">
        <div style="width: 50%; background-color: #f1f5f9; padding: 8px;">
          <h3>Colonne Gauche</h3>
          <p>Description société émettrice</p>
        </div>
        <div style="width: 50%; background-color: #f8fafc; padding: 8px;">
          <h3>Colonne Droite</h3>
          <p>Détails facture et référence</p>
        </div>
      </div>
    `;
    const buf = await renderHtmlToPdf(html);
    assert.ok(buf instanceof Buffer);
    assert.ok(buf.length > 0);
  });

  test('renders grid container with grid-template-columns repeat(4, 1fr)', async () => {
    const html = `
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
        <div style="background-color: #e0e7ff; padding: 6px; border-radius: 4px;">KPI 1</div>
        <div style="background-color: #dcfce7; padding: 6px; border-radius: 4px;">KPI 2</div>
        <div style="background-color: #fef3c7; padding: 6px; border-radius: 4px;">KPI 3</div>
        <div style="background-color: #fee2e2; padding: 6px; border-radius: 4px;">KPI 4</div>
      </div>
    `;
    const buf = await renderHtmlToPdf(html);
    assert.ok(buf instanceof Buffer);
    assert.ok(buf.length > 0);
  });
});

