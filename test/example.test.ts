import { createPdfGenerator } from '../src/pdfGenerator.js';
import * as fs from 'fs';
import * as path from 'path';

let libraryAvailable = false;
try {
  require('@napi-rs/html-to-pdf');
  libraryAvailable = true;
} catch {
  // Library not installed
}

describe('PdfGenerator E2E', () => {
  let generator: ReturnType<typeof createPdfGenerator>;

  beforeAll(() => {
    generator = createPdfGenerator({
      defaultFormat: 'A4',
      defaultOrientation: 'portrait',
      defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
    });
  });

  (libraryAvailable ? it : it.skip)('should generate a valid PDF with tables', async () => {
    const html = `
      <h1 style="color: #333; font-family: Arial;">Rapport</h1>
      <p>Generated on ${new Date().toLocaleDateString()}</p>
      <table style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr style="background-color: #f0f0f0;">
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Name</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Age</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">City</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style="border: 1px solid #ccc; padding: 8px;">Alice</td><td style="border: 1px solid #ccc; padding: 8px;">30</td><td style="border: 1px solid #ccc; padding: 8px;">Paris</td></tr>
          <tr><td style="border: 1px solid #ccc; padding: 8px;">Bob</td><td style="border: 1px solid #ccc; padding: 8px;">25</td><td style="border: 1px solid #ccc; padding: 8px;">Lyon</td></tr>
          <tr><td style="border: 1px solid #ccc; padding: 8px;">Charlie</td><td style="border: 1px solid #ccc; padding: 8px;">35</td><td style="border: 1px solid #ccc; padding: 8px;">Marseille</td></tr>
        </tbody>
      </table>
    `;

    const pdfBuffer = await generator.generate(html);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);

    const outputPath = path.join(__dirname, '..', 'output', 'test-table.pdf');
    fs.mkdirSync(path.join(__dirname, '..', 'output'), { recursive: true });
    fs.writeFileSync(outputPath, pdfBuffer);
  }, 30000);

  (libraryAvailable ? it : it.skip)('should generate a valid PDF with pagination content', async () => {
    let rows = '';
    for (let i = 0; i < 200; i++) {
      rows += `<tr><td style="border: 1px solid #ccc; padding: 4px;">Row ${i}</td><td style="border: 1px solid #ccc; padding: 4px;">Data ${i}</td></tr>`;
    }

    const html = `
      <h1>Rapport Long</h1>
      <table style="border-collapse: collapse; width: 100%;">
        <thead><tr style="background-color: #f0f0f0;">
          <th style="border: 1px solid #ccc; padding: 4px;">ID</th>
          <th style="border: 1px solid #ccc; padding: 4px;">Value</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    const css = `
      body { font-family: Arial, sans-serif; font-size: 10px; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
    `;

    const pdfBuffer = await generator.generate(html, { css });
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);

    const outputPath = path.join(__dirname, '..', 'output', 'test-pagination.pdf');
    fs.mkdirSync(path.join(__dirname, '..', 'output'), { recursive: true });
    fs.writeFileSync(outputPath, pdfBuffer);
  }, 30000);
});
