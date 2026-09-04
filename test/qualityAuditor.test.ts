import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyRenderingQuality, createPdfGenerator } from '../src/index.js';

describe('qualityAuditor - verifyRenderingQuality', () => {
  test('evaluates simple HTML document with high fidelity score', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test</title></head>
        <body>
          <h1>Rapport Annuel</h1>
          <p>La transformation numérique des entreprises accélère.</p>
        </body>
      </html>
    `;

    const result = await verifyRenderingQuality(html);

    assert.ok(result.score >= 90, `Expected score >= 90, got ${result.score}`);
    assert.ok(result.passed);
    assert.ok(result.grade === 'A+' || result.grade === 'A');
    assert.strictEqual(result.features.headings.expected, 1);
    assert.ok(result.textCompleteness.rate > 0.85);
    assert.strictEqual(result.layout.pageCount, 1);
    assert.ok(result.durationMs >= 0);
  });

  test('evaluates document with tables, lists, and box model styles', async () => {
    const html = `
      <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 12px;">
        <h2>Synthèse des Indicateurs</h2>
        <ul>
          <li>Performance opérationnelle : +15%</li>
          <li>Disponibilité système : 99.98%</li>
        </ul>
        <table style="width: 100%; border: 1px solid #94a3b8;">
          <thead>
            <tr><th>Métrique</th><th>Valeur</th></tr>
          </thead>
          <tbody>
            <tr><td>CPU</td><td>45%</td></tr>
            <tr><td>RAM</td><td>2.1 GB</td></tr>
          </tbody>
        </table>
      </div>
    `;

    const result = await verifyRenderingQuality(html);

    assert.ok(result.score >= 90, `Expected score >= 90, got ${result.score}`);
    assert.ok(result.passed);
    assert.strictEqual(result.features.tables.expected, 1);
    assert.strictEqual(result.features.lists.expected, 1);
    assert.ok(result.features.boxDecorations.expected >= 1);
  });

  test('accepts pre-generated PDF buffer', async () => {
    const generator = createPdfGenerator();
    const html = `<h1>Document Pré-généré</h1><p>Contenu validé avec succès.</p>`;
    const buffer = await generator.generate(html);

    const result = await verifyRenderingQuality(html, buffer);

    assert.ok(result.score >= 90);
    assert.ok(result.passed);
    assert.ok(result.textCompleteness.foundInPdfWords > 0);
  });

  test('works via generator.auditQuality() method', async () => {
    const generator = createPdfGenerator();
    const html = `
      <h2>Audit Qualité Intégré</h2>
      <p>Test de la méthode auditQuality sur l'instance de PdfGenerator.</p>
    `;

    const result = await generator.auditQuality(html, { minScoreThreshold: 80 });

    assert.ok(result.score >= 80);
    assert.ok(result.passed);
    assert.strictEqual(result.features.headings.expected, 1);
  });

  test('evaluates editorial report template with excellent fidelity', async () => {
    const templateHtml = readFileSync('demo/templates/1-editorial-report.html', 'utf8');

    const result = await verifyRenderingQuality(templateHtml, {
      options: { margin: { top: 25, bottom: 25, left: 25, right: 25 } },
      minScoreThreshold: 85,
    });

    assert.ok(result.score >= 85, `Expected score >= 85 for template 1, got ${result.score}`);
    assert.ok(result.passed);
    assert.ok(result.textCompleteness.rate >= 0.85);
    assert.strictEqual(result.features.pageZones.expected, true);
    assert.ok(result.features.boxDecorations.expected > 0);
  });
});
