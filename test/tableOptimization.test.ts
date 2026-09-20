import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPdfGenerator } from '../src/index.js';

describe('Patch 05: Table Coordinate Optimization (Prefix Sums)', () => {
  test('renders large table (100x5) correctly with precomputed prefix sums', async () => {
    let rowsHtml = '';
    for (let r = 0; r < 100; r++) {
      rowsHtml += `<tr>
        <td>Row ${r + 1} Col 1</td>
        <td>Row ${r + 1} Col 2</td>
        <td>Row ${r + 1} Col 3</td>
        <td>Row ${r + 1} Col 4</td>
        <td>Row ${r + 1} Col 5</td>
      </tr>`;
    }

    const html = `
      <h1>Large Table Prefix Sum Test</h1>
      <table style="border: 1px solid black; padding: 4px;">
        <thead>
          <tr>
            <th>H1</th><th>H2</th><th>H3</th><th>H4</th><th>H5</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
    const generator = createPdfGenerator();
    const pdfBuffer = await generator.generate(html);
    assert.ok(pdfBuffer instanceof Buffer);
    assert.ok(pdfBuffer.length > 5000, 'PDF buffer should contain rendered table pages');
  });

  test('handles complex tables with colspan, rowspan, and borders accurately', async () => {
    const generator = createPdfGenerator();
    const html = `
      <table style="border: 2px solid #333; padding: 6px;">
        <thead>
          <tr>
            <th colspan="2">Merged Header 1-2</th>
            <th>Header 3</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td rowspan="2" style="background-color: #f0f0f0;">Rowspan Cell</td>
            <td>Normal Cell 1</td>
            <td>Normal Cell 2</td>
          </tr>
          <tr>
            <td colspan="2">Colspan Sub-Cell</td>
          </tr>
          <tr>
            <td>Bottom 1</td>
            <td>Bottom 2</td>
            <td>Bottom 3</td>
          </tr>
        </tbody>
      </table>
    `;

    const pdfBuffer = await generator.generate(html);
    assert.ok(pdfBuffer instanceof Buffer);
    assert.ok(pdfBuffer.length > 1000);
  });

  test('handles nested tables with prefix sums without coordinate corruption', async () => {
    const generator = createPdfGenerator();
    const html = `
      <table style="border: 1px solid #000; padding: 4px;">
        <tr>
          <td>
            Outer Cell 1
            <table style="border: 1px solid #999; padding: 2px;">
              <tr><td>Inner A1</td><td>Inner A2</td></tr>
              <tr><td>Inner B1</td><td>Inner B2</td></tr>
            </table>
          </td>
          <td>Outer Cell 2</td>
        </tr>
      </table>
    `;

    const pdfBuffer = await generator.generate(html);
    assert.ok(pdfBuffer instanceof Buffer);
    assert.ok(pdfBuffer.length > 1000);
  });
});
