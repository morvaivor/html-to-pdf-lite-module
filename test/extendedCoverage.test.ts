import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRemoteUrl,
  decodeDataUri,
  readLocalFile,
  fetchRemoteResource,
  isIpOrHostAllowed,
} from '../src/core/networkSecurity.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolveFontFamily, registerFontFaces } from '../src/core/fontManager.js';
import { parseInlineStyle } from '../src/core/cacheManager.js';
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

    test('allows planned local IPs via allowedLocalIps (exact, wildcard, CIDR)', () => {
      // Exact IP
      assert.doesNotThrow(() =>
        validateRemoteUrl('http://192.168.1.50/styles.css', { allowedLocalIps: ['192.168.1.50'] }),
      );
      assert.throws(
        () => validateRemoteUrl('http://192.168.1.51/styles.css', { allowedLocalIps: ['192.168.1.50'] }),
        /Blocked private\/internal IP: 192.168.1.51/,
      );

      // CIDR range
      assert.doesNotThrow(() =>
        validateRemoteUrl('http://10.0.0.42:8080/app.css', { allowedLocalIps: ['10.0.0.0/24'] }),
      );
      assert.throws(
        () => validateRemoteUrl('http://10.0.1.42:8080/app.css', { allowedLocalIps: ['10.0.0.0/24'] }),
        /Blocked private\/internal IP: 10.0.1.42/,
      );

      // Prefix wildcard
      assert.doesNotThrow(() => validateRemoteUrl('http://172.16.5.10/theme.css', { allowedLocalIps: ['172.16.*'] }));
      assert.doesNotThrow(() => validateRemoteUrl('http://172.16.5.10/theme.css', { allowedLocalIps: ['172.16.'] }));

      // Global wildcard '*' or 'all'
      assert.doesNotThrow(() => validateRemoteUrl('http://192.168.10.20/theme.css', { allowedLocalIps: ['*'] }));
      assert.doesNotThrow(() => validateRemoteUrl('http://192.168.10.20/theme.css', { allowedLocalIps: ['all'] }));

      // Intranet hostname with wildcard
      assert.doesNotThrow(() =>
        validateRemoteUrl('http://css.corp.local/theme.css', { allowedLocalIps: ['*.corp.local'] }),
      );
    });
  });

  describe('isIpOrHostAllowed', () => {
    test('matches exact IPs and hostnames case-insensitively', () => {
      assert.equal(isIpOrHostAllowed('192.168.1.1', ['192.168.1.1']), true);
      assert.equal(isIpOrHostAllowed('MyHost.Local', ['myhost.local']), true);
      assert.equal(isIpOrHostAllowed('::1', ['[::1]']), true);
      assert.equal(isIpOrHostAllowed('192.168.1.2', ['192.168.1.1']), false);
    });

    test('matches CIDR subnets correctly', () => {
      assert.equal(isIpOrHostAllowed('192.168.1.254', ['192.168.1.0/24']), true);
      assert.equal(isIpOrHostAllowed('192.168.2.1', ['192.168.1.0/24']), false);
      assert.equal(isIpOrHostAllowed('10.200.5.1', ['10.0.0.0/8']), true);
      assert.equal(isIpOrHostAllowed('11.0.0.1', ['10.0.0.0/8']), false);
      assert.equal(isIpOrHostAllowed('192.168.1.1', ['0.0.0.0/0']), true);
      assert.equal(isIpOrHostAllowed('192.168.1.1', ['192.168.1.1/32']), true);
      assert.equal(isIpOrHostAllowed('192.168.1.2', ['192.168.1.1/32']), false);
      // Malformed CIDR or invalid IP format
      assert.equal(isIpOrHostAllowed('not-an-ip', ['192.168.1.0/24']), false);
      assert.equal(isIpOrHostAllowed('192.168.1.1', ['192.168.1.0/99']), false);
      assert.equal(isIpOrHostAllowed('192.168.1.1', ['invalid/cidr']), false);
      assert.equal(isIpOrHostAllowed('192.168.1.1', ['']), false);
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

    test('hits cache on repeated calls', () => {
      const first = resolveFontFamily('Helvetica', true, false, null);
      const second = resolveFontFamily('Helvetica', true, false, null);
      assert.equal(first, second);
      assert.equal(second, 'Helvetica-Bold');
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

    test('registers font face from data URI with bold and italic variants', async () => {
      const doc = new (PDFDocument as any)({ autoFirstPage: false });
      const cache = new Map<string, Buffer>();
      const aliasSet = new Set<string>();

      const fakeFontData = Buffer.from('FAKE_TTF_DATA');
      const dataUri = `data:font/ttf;base64,${fakeFontData.toString('base64')}`;
      const css = `
        @font-face { font-family: 'TestFont'; src: url('${dataUri}'); font-weight: bold; font-style: italic; }
        @font-face { font-family: 'TestFontItalic'; src: url('${dataUri}'); font-style: italic; }
        @font-face { font-family: 'TestFontBold'; src: url('${dataUri}'); font-weight: 700; }
      `;

      doc.registerFont = () => doc;

      await registerFontFaces(doc, css, cache, aliasSet);
      assert.ok(aliasSet.has('TestFont-Bold-Italic'));
      assert.ok(aliasSet.has('TestFontItalic-Italic'));
      assert.ok(aliasSet.has('TestFontBold-Bold'));
      assert.ok(cache.has(dataUri));
    });

    test('throws error when remote font cannot be loaded', async () => {
      const doc = new (PDFDocument as any)({ autoFirstPage: false });
      const cache = new Map<string, Buffer>();
      const aliasSet = new Set<string>();
      const css = `@font-face { font-family: 'FailFont'; src: url('http://10.254.254.1/font.ttf'); }`;

      await assert.rejects(async () => {
        await registerFontFaces(doc, css, cache, aliasSet);
      }, /Failed to load font from http:\/\/10\.254\.254\.1\/font\.ttf/);
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

describe('external CSS & allowedLocalIps / allowedCssIps', () => {
  let server: Server;
  let port: number;

  test('setup local HTTP server for CSS tests', async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url === '/style.css') {
          res.writeHead(200, { 'Content-Type': 'text/css' });
          res.end('h1 { color: #ff0000; font-size: 24px; }\n.lead { color: #008800; }');
        } else if (req.url === '/imported.css') {
          res.writeHead(200, { 'Content-Type': 'text/css' });
          res.end('p { color: #0000ff; }');
        } else if (req.url === '/with-import.css') {
          res.writeHead(200, { 'Content-Type': 'text/css' });
          res.end(`@import url("http://127.0.0.1:${port}/imported.css");\nspan { color: #ff00ff; }`);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  test('loads external stylesheet via <link rel="stylesheet"> with allowedLocalIps', async () => {
    const html = `<html><head><link rel="stylesheet" href="http://127.0.0.1:${port}/style.css"></head><body><h1>Title</h1><p class="lead">Lead</p></body></html>`;
    const pdf = await renderHtmlToPdf(html, {
      allowedLocalIps: ['127.0.0.1'],
    });
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);
  });

  test('loads external stylesheet via <link> with allowedCssIps alias', async () => {
    const html = `<html><head><link rel="stylesheet" href="http://127.0.0.1:${port}/style.css"></head><body><h1>Title</h1></body></html>`;
    const pdf = await renderHtmlToPdf(html, {
      allowedCssIps: ['127.0.0.1'],
    });
    assert.ok(pdf instanceof Buffer);
  });

  test('loads stylesheet from URL in options.css', async () => {
    const html = '<h1>Styled via URL</h1>';
    const pdf = await renderHtmlToPdf(html, {
      css: `http://127.0.0.1:${port}/style.css`,
      allowedLocalIps: ['127.0.0.1'],
    });
    assert.ok(pdf instanceof Buffer);
  });

  test('resolves recursive @import rules in CSS', async () => {
    const html = '<p>Imported style</p><span>Span style</span>';
    const pdf = await renderHtmlToPdf(html, {
      css: `http://127.0.0.1:${port}/with-import.css`,
      allowedLocalIps: ['127.0.0.1'],
    });
    assert.ok(pdf instanceof Buffer);
  });

  test('resolves @import with data URI in CSS', async () => {
    const inlineCssBase64 = Buffer.from('p { font-size: 18px; }').toString('base64');
    const cssWithDataImport = `@import url("data:text/css;base64,${inlineCssBase64}"); body { margin: 0; }`;
    const pdf = await renderHtmlToPdf('<p>Data import test</p>', {
      css: cssWithDataImport,
      verbose: true,
      logLevel: 'DEBUG',
    });
    assert.ok(pdf instanceof Buffer);
  });

  test('loads stylesheet from data URI in <link>', async () => {
    const cssContent = Buffer.from('h2 { color: #123456; }').toString('base64');
    const html = `<html><head><link rel="stylesheet" href="data:text/css;base64,${cssContent}"></head><body><h2>Data URI</h2></body></html>`;
    const pdf = await renderHtmlToPdf(html);
    assert.ok(pdf instanceof Buffer);
  });

  test('loads local CSS file via relative/absolute file path in <link>', async () => {
    const testCssFile = 'scratch-temp.css';
    writeFileSync(testCssFile, 'h3 { color: #654321; }');
    try {
      const html = `<html><head><link rel="stylesheet" href="${testCssFile}"></head><body><h3>Local file</h3></body></html>`;
      const pdf = await renderHtmlToPdf(html);
      assert.ok(pdf instanceof Buffer);
    } finally {
      import('node:fs').then(({ unlinkSync }) => {
        try {
          unlinkSync(testCssFile);
        } catch {}
      });
    }
  });

  test('continues gracefully on unauthorized local IP in <link> by default, or blocks with strictCss', async () => {
    const html =
      '<html><head><link rel="stylesheet" href="http://10.254.1.2:9999/style.css"></head><body><h1>Blocked</h1></body></html>';
    // Default: continues gracefully (with WARN)
    const pdf = await renderHtmlToPdf(html, { allowedLocalIps: ['192.168.1.50'] });
    assert.ok(pdf instanceof Buffer);

    // With strictCss: true, throws SSRF error
    await assert.rejects(async () => {
      await renderHtmlToPdf(html, { allowedLocalIps: ['192.168.1.50'], strictCss: true });
    }, /Blocked private\/internal IP: 10.254.1.2/);
  });

  test('continues gracefully on 404 remote stylesheet by default, or throws with strictCss', async () => {
    const html = `<html><head><link rel="stylesheet" href="http://127.0.0.1:${port}/nonexistent.css"></head><body><h1>404</h1></body></html>`;
    // Default: continues gracefully
    const pdf = await renderHtmlToPdf(html, { allowedLocalIps: ['127.0.0.1'] });
    assert.ok(pdf instanceof Buffer);

    // With strictCss: true, throws 404 error
    await assert.rejects(async () => {
      await renderHtmlToPdf(html, { allowedLocalIps: ['127.0.0.1'], strictCss: true });
    }, /Failed to load stylesheet from http:\/\/127\.0\.0\.1/);
  });

  test('PdfGenerator merges allowedLocalIps and works with WorkerPool', async () => {
    const generator = createPdfGenerator({
      useWorkerPool: true,
      allowedLocalIps: ['127.0.0.1'],
    });

    const html = `<html><head><link rel="stylesheet" href="http://127.0.0.1:${port}/style.css"></head><body><h1>Worker Title</h1></body></html>`;
    const pdf = await generator.generate(html);
    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 500);

    await generator.terminateWorkerPool();
  });

  test('teardown local HTTP server', async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
