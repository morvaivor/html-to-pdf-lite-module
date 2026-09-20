import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfGenerator, createPdfGenerator, gpuAccelerator } from '../src/index.js';

describe('WebGPU Native Acceleration — Detection & Fallback', () => {
  test('PdfGenerator exposes getGpuStats() with valid telemetry structure', () => {
    const generator = new PdfGenerator({ gpu: 'auto' });
    const stats = generator.getGpuStats();

    assert.equal(typeof stats.available, 'boolean');
    assert.equal(typeof stats.tablesProcessedCpu, 'number');
    assert.equal(typeof stats.tablesProcessedGpu, 'number');
    assert.equal(typeof stats.gpuKernelTimeMs, 'number');
    assert.equal(typeof stats.gpuUploadTimeMs, 'number');
    assert.equal(typeof stats.gpuReadbackTimeMs, 'number');
    assert.equal(typeof stats.fallbacks, 'number');
  });

  test('generates PDF with gpu: false without attempting GPU initialization', async () => {
    const generator = createPdfGenerator({ gpu: false });
    const html = `<table><tr><td>Cell A</td><td>Cell B</td></tr></table>`;
    const pdf = await generator.generate(html);

    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 0);
  });

  test('generates PDF with gpu: "auto" gracefully falling back to CPU if WebGPU is absent', async () => {
    const generator = createPdfGenerator({ gpu: 'auto' });
    const html = `
      <table border="1">
        <tr><th>Col 1</th><th>Col 2</th></tr>
        <tr><td>Val 1</td><td>Val 2</td></tr>
      </table>
    `;
    const pdf = await generator.generate(html);

    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 0);
  });

  test('generates PDF with explicit gpu: true falling back silently without throwing', async () => {
    const generator = createPdfGenerator();
    const html = `<table><tr><td>Strict GPU Test</td></tr></table>`;
    const pdf = await generator.generate(html, { gpu: true });

    assert.ok(pdf instanceof Buffer);
    assert.ok(pdf.length > 0);
  });

  test('resets GPU stats properly via gpuAccelerator.resetStats()', () => {
    gpuAccelerator.resetStats();
    const stats = gpuAccelerator.getStats();
    assert.equal(stats.tablesProcessedGpu, 0);
    assert.equal(stats.gpuKernelTimeMs, 0);
    assert.equal(stats.fallbacks, 0);
  });
});
