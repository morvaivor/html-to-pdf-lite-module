import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFontFamily, registerFontFaces } from '../src/core/fontManager.js';

describe('Patch 07 — Font Lookup and Caching', () => {
  test('resolves standard built-in fonts and variants correctly', () => {
    assert.equal(resolveFontFamily('Helvetica', false, false, null), 'Helvetica');
    assert.equal(resolveFontFamily('Helvetica', true, false, null), 'Helvetica-Bold');
    assert.equal(resolveFontFamily('Helvetica', false, true, null), 'Helvetica-Oblique');
    assert.equal(resolveFontFamily('Helvetica', true, true, null), 'Helvetica-BoldOblique');

    assert.equal(resolveFontFamily('monospace', false, false, null), 'Courier');
    assert.equal(resolveFontFamily('Courier New', true, false, null), 'Courier-Bold');
    assert.equal(resolveFontFamily('Consolas', false, true, null), 'Courier-Oblique');
    assert.equal(resolveFontFamily('Courier', true, true, null), 'Courier-BoldOblique');

    assert.equal(resolveFontFamily('serif', false, false, null), 'Times-Roman');
    assert.equal(resolveFontFamily('Times New Roman', true, false, null), 'Times-Bold');
    assert.equal(resolveFontFamily('Georgia', false, true, null), 'Times-Italic');
    assert.equal(resolveFontFamily('Times', true, true, null), 'Times-BoldItalic');
  });

  test('resolves custom aliases with O(1) index caching', () => {
    const aliases = new Set(['CustomFont-Bold', 'CustomFont-Italic', 'CustomFont']);

    // First resolution builds index and caches
    const bold1 = resolveFontFamily('CustomFont', true, false, aliases);
    assert.equal(bold1, 'CustomFont-Bold');

    // Second resolution hits directIndex
    const bold2 = resolveFontFamily('CustomFont', true, false, aliases);
    assert.equal(bold2, 'CustomFont-Bold');

    const italic = resolveFontFamily('CustomFont', false, true, aliases);
    assert.equal(italic, 'CustomFont-Italic');

    const regular = resolveFontFamily('CustomFont', false, false, aliases);
    assert.equal(regular, 'CustomFont');
  });

  test('falls back gracefully when specific variant is not registered', () => {
    const aliases = new Set(['BrandFont']);
    // Asking for bold when only regular BrandFont exists should fallback to BrandFont
    const boldFallback = resolveFontFamily('BrandFont', true, false, aliases);
    assert.equal(boldFallback, 'BrandFont');

    // Repeated call hits directIndex cache for fallback
    const boldFallback2 = resolveFontFamily('BrandFont', true, false, aliases);
    assert.equal(boldFallback2, 'BrandFont');
  });

  test('registerFontFaces registers and populates direct lookup index', async () => {
    const registeredFonts = new Map<string, Buffer>();
    const mockDoc = {
      registerFont: (name: string, buffer: Buffer) => {
        registeredFonts.set(name, buffer);
      },
    } as unknown as PDFKit.PDFDocument;

    const fontBufferCache = new Map<string, Buffer>();
    const fakeTtf = Buffer.from('fake-ttf-bytes');
    fontBufferCache.set('https://example.com/inter-reg.ttf', fakeTtf);
    fontBufferCache.set('https://example.com/inter-bold.ttf', fakeTtf);

    const css = `
      @font-face {
        font-family: 'Inter';
        src: url('https://example.com/inter-reg.ttf');
      }
      @font-face {
        font-family: 'Inter';
        font-weight: bold;
        src: url('https://example.com/inter-bold.ttf');
      }
    `;

    const aliasSet = new Set<string>();
    await registerFontFaces(mockDoc, css, fontBufferCache, aliasSet);

    assert.ok(aliasSet.has('Inter'));
    assert.ok(aliasSet.has('Inter-Bold'));

    // Fast direct O(1) resolution
    assert.equal(resolveFontFamily('Inter', false, false, aliasSet), 'Inter');
    assert.equal(resolveFontFamily('Inter', true, false, aliasSet), 'Inter-Bold');
  });
});
