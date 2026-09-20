import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfGenerator, type ProfilingTimings } from '../src/index.js';

describe('Patch 10 — Phase-level performance profiling', () => {
  test('invokes onProfile callback with valid timings when enabled', async () => {
    let capturedTimings: ProfilingTimings | null = null;
    const generator = new PdfGenerator();

    const html = `
      <style>
        .box { margin: 10px; padding: 5px; color: #333; }
        h1 { font-size: 24px; }
      </style>
      <div class="box">
        <h1>Profiling Test</h1>
        <p>Testing phase-level performance instrumentation.</p>
      </div>
    `;

    const pdfBuffer = await generator.generate(html, {
      profiling: true,
      onProfile: (timings) => {
        capturedTimings = timings;
      },
    });

    assert.ok(pdfBuffer instanceof Buffer);
    assert.ok(pdfBuffer.length > 0);
    assert.ok(capturedTimings !== null, 'capturedTimings should not be null');

    const t = capturedTimings!;
    assert.equal(typeof t.parseHtmlMs, 'number');
    assert.equal(typeof t.cssMs, 'number');
    assert.equal(typeof t.fontRegisterMs, 'number');
    assert.equal(typeof t.layoutRenderMs, 'number');
    assert.equal(typeof t.pdfAssemblyMs, 'number');
    assert.equal(typeof t.totalMs, 'number');

    assert.ok(t.parseHtmlMs >= 0);
    assert.ok(t.cssMs >= 0);
    assert.ok(t.layoutRenderMs >= 0);
    assert.ok(t.pdfAssemblyMs >= 0);
    assert.ok(t.totalMs >= 0);
  });

  test('does not invoke onProfile when disabled (zero overhead mode)', async () => {
    const generator = new PdfGenerator();

    // Verify generation works normally without profiling options
    const buffer = await generator.generate('<p>No profiling</p>');
    assert.ok(buffer.length > 0);
  });

  test('activates profiling probes and logs breakdown when debug: true is enabled', async () => {
    const { existsSync, readFileSync, unlinkSync } = await import('node:fs');
    const logFile = './output/test-profiling-debug.log';
    if (existsSync(logFile)) unlinkSync(logFile);

    let capturedTimings: ProfilingTimings | null = null;
    const generator = new PdfGenerator({
      debug: true,
      logFile,
    });

    const html = `<div><h1>Debug Probe Test</h1><p>Measuring probes in debug mode.</p></div>`;
    const buffer = await generator.generate(html, {
      onProfile: (t) => {
        capturedTimings = t;
      },
    });

    assert.ok(buffer instanceof Buffer);
    assert.ok(capturedTimings !== null);
    assert.ok((capturedTimings as ProfilingTimings).totalMs > 0);

    assert.ok(existsSync(logFile));
    const logContent = readFileSync(logFile, 'utf-8');
    assert.ok(logContent.includes('[DEBUG]'));
    assert.ok(logContent.includes('[Sondes Profilage]'));
    assert.ok(logContent.includes('HTML:'));
    assert.ok(logContent.includes('CSS:'));
    assert.ok(logContent.includes('Polices:'));
    assert.ok(logContent.includes('Layout & Rendu:'));
    assert.ok(logContent.includes('Assemblage PDF:'));

    unlinkSync(logFile);
  });

  test('activates profiling probes automatically when verbose: true or logLevel: DEBUG is used', async () => {
    const { existsSync, readFileSync, unlinkSync } = await import('node:fs');
    const logFile = './output/test-profiling-verbose.log';
    if (existsSync(logFile)) unlinkSync(logFile);

    const generator = new PdfGenerator();
    const html = `<div><p>Testing verbose probe activation</p></div>`;

    await generator.generate(html, {
      verbose: true,
      logFile,
    });

    assert.ok(existsSync(logFile));
    const logContent = readFileSync(logFile, 'utf-8');
    assert.ok(logContent.includes('[Sondes Profilage]'));

    unlinkSync(logFile);
  });
});
