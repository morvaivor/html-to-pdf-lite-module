/**
 * Sample documents rendered by `performanceInnovations.test.ts` both in-process (accelerated) and in a
 * child process with `PDF_LITE_ACCEL=off` (stock PDFKit): their normalized SHA-256 must match.
 * Run directly, this module prints the JSON map of hashes on stdout.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensurePdfKitAccelerator, renderHtmlToPdf } from '../../src/index.js';
import type { PdfGenerateOptions } from '../../src/types.js';

const fixtureDir = fileURLToPath(new URL('.', import.meta.url));
const templatesDir = fileURLToPath(new URL('../../demo/templates/', import.meta.url));
const fontUri = (file: string): string =>
  `data:font/ttf;base64,${readFileSync(`${fixtureDir}fonts/${file}`).toString('base64')}`;

interface Sample {
  readonly name: string;
  readonly html: string;
  readonly options?: PdfGenerateOptions;
}

export const SAMPLES: readonly Sample[] = [
  { name: 'template-editorial', html: readFileSync(`${templatesDir}1-editorial-report.html`, 'utf-8') },
  { name: 'template-invoice', html: readFileSync(`${templatesDir}4-invoice-pro.html`, 'utf-8') },
  { name: 'template-medical', html: readFileSync(`${templatesDir}7-medical-report.html`, 'utf-8') },
  {
    name: 'typography',
    html: `
      <h1>AVAWAY Tj LT Yo “quotes” — l’été à 12 € … Œuvre œ ™ → ¿ß</h1>
      <p style="text-align: justify">${'Kerning pairs AV, To, Wa, Ye, P. and T, stress every glyph path. '.repeat(12)}</p>
      <p>Mixed <b>bold</b>, <i>italic</i>, <strong><em>both</em></strong> and <span style="color: #c00">red</span> runs.</p>
      <p style="text-transform: uppercase; letter-spacing: 1.5; text-decoration: underline">spaced capitals</p>
      <p style="font-family: 'Courier New'; text-align: right">monospace right</p>
      <p style="font-family: Georgia, serif; text-align: center; line-height: 1.6">Times centered</p>
      <ul><li>First <b>item</b></li><li>Second<ol><li>Nested</li></ol></li></ul>`,
  },
  {
    name: 'styled-table',
    html: `
      <style>
        table { border: 1px solid #999; padding: 3px; }
        th { background-color: #1e293b; color: white; }
        tr.odd td { background-color: #f8fafc; }
        .num { text-align: right; } .neg { color: #b91c1c; }
        .tag { background-color: #e0f2fe; padding: 2px; border: 1px solid #0284c7; }
      </style>
      <table><thead><tr><th>Code</th><th colspan="2">Amount</th><th>Tag</th></tr></thead><tbody>
      ${Array.from(
        { length: 40 },
        (_, r) =>
          `<tr class="${r % 2 ? 'odd' : 'even'}"><td rowspan="${r % 7 === 0 ? 2 : 1}">R${r}</td>` +
          `<td class="num ${r % 5 ? '' : 'neg'}">${(r * 37.5).toFixed(2)}</td><td>${r % 3 ? 'EUR' : 'USD'}</td>` +
          `<td><span class="tag">T${r % 4}</span></td></tr>`,
      ).join('')}
      </tbody></table>`,
  },
  {
    name: 'custom-font',
    html: `
      <style>
        @font-face { font-family: 'Arvo'; src: url('${fontUri('Arvo-Regular.ttf')}'); }
        @font-face { font-family: 'Arvo'; font-weight: bold; src: url('${fontUri('Arvo-Bold.ttf')}'); }
        body { font-family: 'Arvo'; }
      </style>
      <h2 style="font-family: Arvo">Embedded AVAWAY</h2>
      <p style="font-family: Arvo">Regular <b>bold</b> text with the embedded font and Helvetica fallback.</p>`,
  },
  {
    name: 'page-zones',
    html: `
      <style>
        @page { @top-right { content: "Page " counter(page) " / " counter(num-pages); font-size: 9px; color: #555; }
                @bottom-center { content: "Confidential"; font-weight: bold; } }
      </style>
      ${'<p>Filler paragraph for several pages with page-dependent zones.</p>'.repeat(120)}`,
  },
  {
    name: 'header-footer',
    html: '<h2>Report</h2>' + '<p>Body text repeated to span pages.</p>'.repeat(90),
    options: { header: '<div style="font-size: 9px">Header {page}/{totalPages}</div>', footer: 'Footer {page}' },
  },
  {
    name: 'svg-and-colors',
    html: `
      <svg width="200" height="60" viewBox="0 0 200 60">
        <rect x="0" y="0" width="200" height="60" fill="#eef" stroke="navy"/>
        <text x="10" y="35" font-family="Helvetica" font-size="16" fill="#123">SVG AVAWAY text</text>
      </svg>
      <div style="background-color: #abc; border: 2px solid teal; padding: 6px; border-radius: 4px">
        <p style="color: red">Named</p><p style="color: #0f0">Short hex</p><p style="color: rgb(1, 2, 3)">rgb()</p>
      </div>
      <div style="display: flex; gap: 10px"><div style="width: 50%">Left column</div><div>Right column</div></div>
      <div style="display: grid; grid-template-columns: 1fr 2fr"><div>Grid A</div><div>Grid B</div></div>`,
  },
];

/** Removes the only time-dependent bytes (the CreationDate string object and the /ID derived from it). */
export function normalizePdf(pdf: Buffer): Buffer {
  const text = pdf
    .toString('latin1')
    .replace(/\(D:\d{14}Z\)/g, '(D:00000000000000Z)')
    .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [<> <>]');
  return Buffer.from(text, 'latin1');
}

export async function renderSampleHashes(): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const sample of SAMPLES) {
    const pdf = await renderHtmlToPdf(sample.html, { gpu: false, ...sample.options });
    hashes[sample.name] = createHash('sha256').update(normalizePdf(pdf)).digest('hex');
  }
  return hashes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hashes = await renderSampleHashes();
  process.stdout.write(`${JSON.stringify({ accelerator: ensurePdfKitAccelerator(), hashes })}\n`);
}
