import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRemoteUrl, decodeDataUri, readLocalFile, fetchRemoteResource } from '../src/core/networkSecurity.js';
import { resolveFontFamily, registerFontFaces } from '../src/core/fontManager.js';
import { parseInlineStyle, TextMeasureCache } from '../src/core/cacheManager.js';
import { renderHtmlToPdf } from '../src/htmlRenderer.js';
import { createPdfGenerator } from '../src/index.js';
import { calculateMaxWorkers } from '../src/workers/workerPool.js';
import PDFDocument from 'pdfkit';
import { writeFileSync, mkdirSync } from 'node:fs';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_BASE64}`;
const TINY_SVG_DATA_URI =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCI+PHJlY3Qgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSJyZWQiLz48L3N2Zz4=';

describe('networkSecurity', () => {
  describe('validateRemoteUrl', () => {
    test('allows valid public HTTPS URLs', () => {
      assert.doesNotThrow(() => validateRemoteUrl('https://fonts.googleapis.com/css2'));
      assert.doesNotThrow(() => validateRemoteUrl('http://example.com/image.png'));
    });

    test('throws on malformed URL strings', () => {
      assert.throws(() => validateRemoteUrl('not-a-valid-url'), /Invalid URL/);
      assert.throws(() => validateRemoteUrl(''), /Invalid URL/);
    });

    test('throws on unsupported protocols', () => {
      assert.throws(() => validateRemoteUrl('ftp://example.com/font.ttf'), /Unsupported protocol: ftp:/);
      assert.throws(() => validateRemoteUrl('file:///etc/passwd'), /Unsupported protocol: file:/);
      assert.throws(() => validateRemoteUrl('gopher://example.com'), /Unsupported protocol: gopher:/);
    });

    test('blocks internal metadata service hosts', () => {
      assert.throws(() => validateRemoteUrl('http://metadata.google.internal/computeMetadata/v1'), /Blocked host/);
      assert.throws(() => validateRemoteUrl('http://metadata.internal/'), /Blocked host/);
    });

    test('blocks private IPv4 addresses (SSRF prevention)', () => {
      assert.throws(() => validateRemoteUrl('http://10.0.0.1/admin'), /Blocked private\/internal IP/);
      assert.throws(() => validateRemoteUrl('http://172.16.0.5/api'), /Blocked private\/internal IP/);
      assert.throws(() => validateRemoteUrl('http://172.31.255.255/'), /Blocked private\/internal IP/);
      assert.throws(() => validateRemoteUrl('http://192.168.1.1/router'), /Blocked private\/internal IP/);
      assert.throws(
        () => validateRemoteUrl('http://169.254.169.254/latest/meta-data/'),
        /Blocked private\/internal IP/,
      );
    });

    test('blocks IPv6 local addresses', () => {
      assert.throws(() => validateRemoteUrl('http://[fe80::1]/'), /Blocked private\/internal IP/);
    });

    test('blocks localhost when allowLocalhost is false', () => {
      assert.throws(() => validateRemoteUrl('http://localhost:3000', false), /Blocked host: localhost/);
      assert.throws(() => validateRemoteUrl('http://127.0.0.1:8080', false), /Blocked host: 127.0.0.1/);
      assert.throws(() => validateRemoteUrl('http://[::1]:8080', false), /Blocked host: ::1/);
    });

    test('allows localhost when allowLocalhost is true', () => {
      assert.doesNotThrow(() => validateRemoteUrl('http://localhost:3000', true));
      assert.doesNotThrow(() => validateRemoteUrl('http://127.0.0.1:8080', true));
      assert.doesNotThrow(() => validateRemoteUrl('http://[::1]:8080', true));
    });
  });

  describe('fetchRemoteResource', () => {
    test('rejects blocked SSRF targets before fetching', async () => {
      await assert.rejects(async () => {
        await fetchRemoteResource('http://10.0.0.1/secret');
      }, /Blocked private\/internal IP/);
    });
  });

  describe('decodeDataUri', () => {
    test('decodes valid base64 data URI', () => {
      const sampleText = 'Hello PDF World';
      const base64 = Buffer.from(sampleText).toString('base64');
      const dataUri = `data:text/plain;base64,${base64}`;
      const decoded = decodeDataUri(dataUri);
      assert.equal(decoded.toString('utf-8'), sampleText);
    });

    test('throws on missing base64 marker', () => {
      assert.throws(() => decodeDataUri('data:text/plain;charset=utf-8,Hello'), /Invalid data: URI/);
    });

    test('throws on oversized payload', () => {
      const hugeString = 'A'.repeat(15 * 1024 * 1024);
      assert.throws(() => decodeDataUri(`data:application/octet-stream;base64,${hugeString}`), /Data URI too large/);
    });
  });

  describe('readLocalFile', () => {
    test('reads existing local file within working directory', () => {
      const buf = readLocalFile('package.json');
      assert.ok(buf instanceof Buffer);
      assert.ok(buf.length > 0);
      assert.ok(buf.toString('utf-8').includes('pdf-generator'));
    });

    test('throws on paths escaping outside working directory', () => {
      assert.throws(() => readLocalFile('../../outside.txt'), /File path outside working directory/);
    });
  });
});

describe('fontManager', () => {
  describe('resolveFontFamily', () => {
    test('resolves standard Helvetica variants', () => {
      assert.equal(resolveFontFamily('Helvetica', false, false, null), 'Helvetica');
      assert.equal(resolveFontFamily('Helvetica', true, false, null), 'Helvetica-Bold');
      assert.equal(resolveFontFamily('Helvetica', false, true, null), 'Helvetica-Oblique');
      assert.equal(resolveFontFamily('Helvetica', true, true, null), 'Helvetica-BoldOblique');
    });

    test('normalizes and resolves monospace font to Courier', () => {
      assert.equal(resolveFontFamily('monospace', false, false, null), 'Courier');
      assert.equal(resolveFontFamily('Courier New', true, false, null), 'Courier-Bold');
      assert.equal(resolveFontFamily('Consolas', false, true, null), 'Courier-Oblique');
      assert.equal(resolveFontFamily('Courier', true, true, null), 'Courier-BoldOblique');
    });

    test('normalizes and resolves serif fonts to Times-Roman', () => {
      assert.equal(resolveFontFamily('serif', false, false, null), 'Times-Roman');
      assert.equal(resolveFontFamily('Times New Roman', true, false, null), 'Times-Bold');
      assert.equal(resolveFontFamily('Georgia', false, true, null), 'Times-Italic');
      assert.equal(resolveFontFamily('Times', true, true, null), 'Times-BoldItalic');
    });

    test('falls back to custom registered alias matching base name', () => {
      const aliases = new Set(['CustomFont-Bold', 'CustomFont']);
      assert.equal(resolveFontFamily('CustomFont', true, false, aliases), 'CustomFont-Bold');
    });
  });

  describe('registerFontFaces', () => {
    test('handles empty css or css without font faces gracefully', async () => {
      const doc = new (PDFDocument as any)({ autoFirstPage: false });
      const cache = new Map<string, Buffer>();
      const aliasSet = new Set<string>();

      await registerFontFaces(doc, '', cache, aliasSet);
      assert.equal(aliasSet.size, 0);

      await registerFontFaces(doc, 'p { color: red; }', cache, aliasSet);
      assert.equal(aliasSet.size, 0);
    });

    test('registers font face from data URI', async () => {
      const doc = new (PDFDocument as any)({ autoFirstPage: false });
      const cache = new Map<string, Buffer>();
      const aliasSet = new Set<string>();

      const fakeFontData = Buffer.from('FAKE_TTF_DATA');
      const dataUri = `data:font/ttf;base64,${fakeFontData.toString('base64')}`;
      const css = `@font-face { font-family: 'TestFont'; src: url('${dataUri}'); }`;

      doc.registerFont = () => doc;

      await registerFontFaces(doc, css, cache, aliasSet);
      assert.ok(aliasSet.has('TestFont'));
      assert.ok(cache.has(dataUri));
    });
  });
});

describe('cacheManager & Box Spacing', () => {
  test('parses box spacing with 1, 2, 3, and 4 parts', () => {
    const el1 = { attribs: { style: 'padding: 10px;' } };
    assert.equal(parseInlineStyle(el1).padding, 10);
    assert.equal(parseInlineStyle(el1).paddingTop, 10);

    const el2 = { attribs: { style: 'padding: 5px 15px;' } };
    assert.equal(parseInlineStyle(el2).paddingTop, 5);
    assert.equal(parseInlineStyle(el2).paddingRight, 15);
    assert.equal(parseInlineStyle(el2).paddingBottom, 5);
    assert.equal(parseInlineStyle(el2).paddingLeft, 15);

    const el3 = { attribs: { style: 'margin: 5px 10px 15px;' } };
    assert.equal(parseInlineStyle(el3).marginTop, 5);
    assert.equal(parseInlineStyle(el3).marginRight, 10);
    assert.equal(parseInlineStyle(el3).marginBottom, 15);
    assert.equal(parseInlineStyle(el3).marginLeft, 10);

    const el4 = { attribs: { style: 'margin: 1px 2px 3px 4px;' } };
    assert.equal(parseInlineStyle(el4).marginTop, 1);
    assert.equal(parseInlineStyle(el4).marginRight, 2);
    assert.equal(parseInlineStyle(el4).marginBottom, 3);
    assert.equal(parseInlineStyle(el4).marginLeft, 4);
  });

  test('parses individual border sides and shorthand styles', () => {
    const el1 = {
      attribs: {
        style:
          'border-left: 2px solid red; border-top: 1px dashed blue; border-right: 3px dotted green; border-bottom: 4px double black;',
      },
    };
    const style1 = parseInlineStyle(el1);
    assert.equal(style1.borderLeftWidth, 2);
    assert.equal(style1.borderLeftColor, 'red');
    assert.equal(style1.borderTopWidth, 1);
    assert.equal(style1.borderTopColor, 'blue');
    assert.equal(style1.borderRightWidth, 3);
    assert.equal(style1.borderRightColor, 'green');
    assert.equal(style1.borderBottomWidth, 4);
    assert.equal(style1.borderBottomColor, 'black');

    const el2 = { attribs: { style: 'border: none; border-width: 3px; border-color: #333333;' } };
    const style2 = parseInlineStyle(el2);
    assert.equal(style2.borderWidth, 3);
    assert.equal(style2.borderColor, '#333333');

    const el3 = { attribs: { style: 'border: 0;' } };
    const style3 = parseInlineStyle(el3);
    assert.equal(style3.borderWidth, 0);
  });

  test('validates hex, rgb, rgba, and named colors', () => {
    const el1 = { attribs: { style: 'color: rgb(255, 0, 0); background-color: rgba(0, 0, 255, 0.5);' } };
    const s1 = parseInlineStyle(el1);
    assert.equal(s1.color, 'rgb(255, 0, 0)');
    assert.equal(s1.backgroundColor, 'rgba(0, 0, 255, 0.5)');

    const el2 = { attribs: { style: 'color: navy; background-color: transparent;' } };
    const s2 = parseInlineStyle(el2);
    assert.equal(s2.color, 'navy');

    const el3 = { attribs: { style: 'color: invalid-color;' } };
    const s3 = parseInlineStyle(el3);
    assert.equal(s3.color, '#000000');
  });

  test('parses advanced typography and transform styles', () => {
    const el = {
      attribs: {
        style:
          'line-height: 1.6; letter-spacing: 0.5; text-decoration: underline; text-transform: uppercase; border-radius: 8px;',
      },
    };
    const s = parseInlineStyle(el);
    assert.equal(s.lineHeight, 1.6);
    assert.equal(s.letterSpacing, 0.5);
    assert.equal(s.textDecoration, 'underline');
    assert.equal(s.textTransform, 'uppercase');
    assert.equal(s.borderRadius, 8);
  });

  test('handles style cache overflow cleanly without leaking', () => {
    for (let i = 0; i < 300; i++) {
      parseInlineStyle({ attribs: { style: `font-size: ${10 + (i % 20)}px; color: #${i % 9}00;` } });
    }
    const finalStyle = parseInlineStyle({ attribs: { style: 'font-size: 14px;' } });
    assert.equal(finalStyle.fontSize, 14);
  });
});

describe('imageRenderer', () => {
  const localImgPath = 'output/test-ext-img.png';
  mkdirSync('output', { recursive: true });
  writeFileSync(localImgPath, Buffer.from(TINY_PNG_BASE64, 'base64'));

  test('renders image from local file', async () => {
    const html = `<img src="${localImgPath}" width="50" height="50" />`;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });

  test('uses image cache on duplicate image URLs', async () => {
    const html = `
      <img src="${TINY_PNG_DATA_URI}" width="20" height="20" />
      <img src="${TINY_PNG_DATA_URI}" width="30" height="30" />
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });

  test('renders SVG data URI in img tag and scales down if oversized', async () => {
    const html = `
      <img src="${TINY_SVG_DATA_URI}" width="1500" height="750" />
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });

  test('triggers page break when image exceeds remaining page height', async () => {
    let html = '<h1>Page 1 Content</h1>';
    for (let i = 0; i < 30; i++) {
      html += `<p>Paragraph ${i}: filling page space before image</p>`;
    }
    html += `<img src="${TINY_PNG_DATA_URI}" width="300" height="250" />`;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 1000);
  });

  test('triggers page break when SVG image exceeds remaining page height', async () => {
    let html = '<h1>Page 1 with SVG</h1>';
    for (let i = 0; i < 30; i++) {
      html += `<p>Line ${i}</p>`;
    }
    html += `<img src="${TINY_SVG_DATA_URI}" width="200" height="250" />`;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 1000);
  });

  test('renders image with only height attribute and auto width', async () => {
    const html = `<img src="${TINY_PNG_DATA_URI}" height="80" />`;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });
});

describe('svgRenderer', () => {
  test('renders inline SVG with explicit width and height', async () => {
    const html = `
      <h1>SVG Vector Graphic</h1>
      <svg width="200" height="100">
        <rect x="10" y="10" width="180" height="80" fill="#003366" stroke="#ff9900" stroke-width="2" />
        <circle cx="100" cy="50" r="30" fill="#ffffff" />
      </svg>
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });

  test('renders SVG with viewBox and auto-calculated aspect ratio', async () => {
    const html = `
      <svg viewBox="0 0 400 200" style="width: 300px;">
        <ellipse cx="200" cy="100" rx="150" ry="80" fill="purple" />
      </svg>
      <svg viewBox="0 0 200 100" height="60">
        <rect width="200" height="100" fill="teal" />
      </svg>
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });

  test('scales down oversized SVG wider than page content width', async () => {
    const html = `
      <svg width="2500" height="1000">
        <rect width="2500" height="1000" fill="green" />
      </svg>
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });

  test('triggers page break when SVG exceeds page bottom', async () => {
    let html = '<h1>SVG Pagination</h1>';
    for (let i = 0; i < 30; i++) {
      html += `<p>Content line ${i}</p>`;
    }
    html += '<svg width="200" height="300"><circle cx="100" cy="150" r="80" fill="red" /></svg>';
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 1000);
  });

  test('renders SVG with text-align center and right', async () => {
    const html = `
      <div style="text-align: center;">
        <svg width="100" height="50"><rect width="100" height="50" fill="orange" /></svg>
      </div>
      <div style="text-align: right;">
        <svg width="100" height="50"><rect width="100" height="50" fill="blue" /></svg>
      </div>
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });

  test('handles malformed SVG gracefully without throwing', async () => {
    const html = `
      <h1>Malformed SVG</h1>
      <svg width="100" height="100"><invalid-tag-with-broken-syntax></svg>
      <p>Follow-up content renders normally.</p>
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });
});

describe('textRenderer & Typography Edge Cases', () => {
  test('renders text with margins, letter-spacing, and bottom border', async () => {
    const html = `
      <h2 style="margin-top: 25px; margin-bottom: 15px; letter-spacing: 1.5px; border-bottom: 2px solid #336699; padding-bottom: 6px; text-transform: capitalize;">
        section title capitalized
      </h2>
      <p style="margin-left: 20px; margin-right: 20px; line-height: 1.8; text-transform: lowercase;">
        ALL LOWERCASE PARAGRAPH WITH WIDE INDENTATION
      </p>
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 600);
  });

  test('renders inline runs with text-decoration and transform', async () => {
    const html = `
      <p>
        Regular text, <span style="text-decoration: underline; text-transform: uppercase;">underlined upper</span>,
        <span style="text-decoration: line-through;">strike text</span>, and
        <span style="text-transform: capitalize;">capitalized run text</span>.
      </p>
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });
});

describe('flexGridRenderer & Advanced Layout', () => {
  test('renders grid with mixed units: px, %, and fr', async () => {
    const html = `
      <div style="display: grid; grid-template-columns: 80px 40% 1fr; gap: 10px;">
        <div style="background:#eee;">80px</div>
        <div style="background:#ddd;">40%</div>
        <div style="background:#ccc;">1fr</div>
      </div>
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 600);
  });

  test('renders flex container with mixed explicit and unallocated widths', async () => {
    const html = `
      <div style="display: flex; flex-direction: row; gap: 8px;">
        <div style="width: 120px; background: #fee;">Fixed 120px</div>
        <div style="background: #efe;">Auto flex item 1</div>
        <div style="background: #eef;">Auto flex item 2</div>
      </div>
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 600);
  });

  test('renders flex container with default equal column distribution', async () => {
    const html = `
      <div style="display: flex;">
        <div>Col A</div>
        <div>Col B</div>
        <div>Col C</div>
      </div>
    `;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });
});

describe('headerFooterRenderer Edge Cases', () => {
  test('renders plain-text header aligned center and right', async () => {
    const generator = createPdfGenerator({
      header: 'Right Aligned Title',
      footer: 'Center Aligned Footer',
    });
    const pdf = await generator.generate('<p>Page with custom header/footer</p>');
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });

  test('renders rich HTML header and footer with custom font size and colors', async () => {
    const generator = createPdfGenerator();
    const pdf = await generator.generate('<p>Content with HTML header and footer</p>', {
      header: '<div style="font-size: 10px; color: #003366;"><p>Company Header</p></div>',
      footer: '<div style="font-size: 9px; color: #666666;"><span>Footer Page Note</span></div>',
    });
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });
});

describe('workerPool & PdfGenerator Edge Cases', () => {
  test('calculateMaxWorkers clamps extreme ratios', () => {
    const minWorkers = calculateMaxWorkers(0.01);
    assert.ok(minWorkers >= 1);

    const maxWorkers = calculateMaxWorkers(10.0);
    assert.ok(maxWorkers >= 1);

    const explicitWorkers = calculateMaxWorkers(0.5, 4);
    assert.equal(explicitWorkers, 4);
  });

  test('WorkerPool rejects on empty HTML input', async () => {
    const generator = createPdfGenerator({ useWorkerPool: true, cpuRatio: 0.5 });
    await assert.rejects(async () => {
      await generator.generate('');
    }, /HTML content must be a non-empty string/);
    await generator.terminateWorkerPool();
  });

  test('PdfGenerator terminating multiple times is safe and idempotent', async () => {
    const generator = createPdfGenerator({ useWorkerPool: true, cpuRatio: 0.5 });
    await generator.terminateWorkerPool();
    await generator.terminateWorkerPool();
    assert.equal(generator.getWorkerStats().totalWorkers, 0);
  });
});
