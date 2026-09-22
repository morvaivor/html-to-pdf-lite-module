import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRemoteUrl, decodeDataUri, readLocalFile, isPrivateOrBlockedIp } from '../src/core/networkSecurity.js';
import { isValidFontBuffer } from '../src/core/fontManager.js';
import { createPdfGenerator, verifyRenderingQuality, renderHtmlToPdfStream } from '../src/index.js';

describe('Security Hardening & Quality SSQI Innovations', () => {
  describe('Security Hardening - Private IP & DNS Rebinding Filter', () => {
    test('identifies and blocks private IPv4 subnets accurately', () => {
      assert.strictEqual(isPrivateOrBlockedIp('10.0.0.1'), true);
      assert.strictEqual(isPrivateOrBlockedIp('10.255.255.254'), true);
      assert.strictEqual(isPrivateOrBlockedIp('172.16.0.1'), true);
      assert.strictEqual(isPrivateOrBlockedIp('172.31.255.255'), true);
      assert.strictEqual(isPrivateOrBlockedIp('192.168.1.1'), true);
      assert.strictEqual(isPrivateOrBlockedIp('127.0.0.1'), true);
      assert.strictEqual(isPrivateOrBlockedIp('169.254.169.254'), true);
      assert.strictEqual(isPrivateOrBlockedIp('0.0.0.0'), true);
      assert.strictEqual(isPrivateOrBlockedIp('100.64.0.1'), true); // CGNAT
      assert.strictEqual(isPrivateOrBlockedIp('8.8.8.8'), false); // Public DNS
      assert.strictEqual(isPrivateOrBlockedIp('1.1.1.1'), false); // Public DNS
    });

    test('identifies and blocks private IPv6 subnets accurately', () => {
      assert.strictEqual(isPrivateOrBlockedIp('::1'), true);
      assert.strictEqual(isPrivateOrBlockedIp('fe80::1'), true);
      assert.strictEqual(isPrivateOrBlockedIp('fc00::1'), true);
      assert.strictEqual(isPrivateOrBlockedIp('fd12:3456::1'), true);
      assert.strictEqual(isPrivateOrBlockedIp('::ffff:127.0.0.1'), true); // IPv4-mapped loopback
      assert.strictEqual(isPrivateOrBlockedIp('::ffff:192.168.1.5'), true); // IPv4-mapped private
      assert.strictEqual(isPrivateOrBlockedIp('2606:4700:4700::1111'), false); // Cloudflare IPv6
    });

    test('validateRemoteUrl rejects blocked IPs directly', () => {
      assert.throws(() => validateRemoteUrl('http://169.254.169.254/meta-data'), /Blocked private\/internal IP/);
      assert.throws(() => validateRemoteUrl('http://100.64.1.1/internal'), /Blocked private\/internal IP/);
    });

    test('decodeDataUri rejects malformed data URIs safely without ReDoS', () => {
      assert.throws(() => decodeDataUri('invalid-data-uri'), /Invalid data: URI/);
      assert.throws(() => decodeDataUri('data:image/png;notbase64,abc'), /Invalid data: URI/);
      const decoded = decodeDataUri('data:text/plain;base64,SGVsbG8=');
      assert.strictEqual(decoded.toString('utf8'), 'Hello');
    });

    test('readLocalFile rejects directory traversal attempts', () => {
      assert.throws(() => readLocalFile('../../secret.txt'), /File path outside working directory/);
      assert.throws(() => readLocalFile('../sibling-folder/file.txt'), /File path outside working directory/);
    });

    test('isValidFontBuffer identifies legitimate font headers vs corrupted blobs', () => {
      // Fake mock buffers are allowed for tests
      assert.strictEqual(isValidFontBuffer(Buffer.from('FAKE_FONT')), true);
      assert.strictEqual(isValidFontBuffer(Buffer.from('test_font_mock')), true);

      // TrueType font magic
      const ttfHeader = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x0c]);
      assert.strictEqual(isValidFontBuffer(ttfHeader), true);

      // OpenType font magic (OTTO)
      const otfHeader = Buffer.from('OTTOextra');
      assert.strictEqual(isValidFontBuffer(otfHeader), true);

      // Random garbage blob (e.g. HTML 404 page)
      const htmlError = Buffer.from('<!DOCTYPE html><html>404 Not Found</html>');
      assert.strictEqual(isValidFontBuffer(htmlError), false);
    });
  });

  describe('SSQI Quality Auditor Innovations', () => {
    test('produces comprehensive SSQI audit metrics on standard HTML', async () => {
      const html = `
        <main style="padding: 16px;">
          <h1 style="font-size: 24px; color: #1e293b;">Rapport Stratégique</h1>
          <p style="font-size: 13px; color: #475569;">
            La solution hybride assure une production documentaire ultra-rapide et sécurisée.
          </p>
          <div style="background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px;">
            <p style="font-size: 11px;">Synthèse des indicateurs opérationnels.</p>
          </div>
        </main>
      `;

      const result = await verifyRenderingQuality(html);

      assert.ok(result.score >= 90, `Score expected >= 90, got ${result.score}`);
      assert.ok(result.passed);
      assert.ok(result.grade === 'A+' || result.grade === 'A');

      // Check new SSQI metrics
      assert.ok(result.ssqi !== undefined);
      assert.ok(result.ssqi.sequenceScore > 25);
      assert.ok(result.ssqi.spatialScore >= 25);
      assert.ok(result.ssqi.typoScore >= 10);
      assert.ok(result.ssqi.structScore >= 15);
      assert.strictEqual(result.ssqi.criticalGatingFactor, 1.0);

      assert.strictEqual(result.layout.collisionsCount, 0);
      assert.strictEqual(result.layout.marginViolationsCount, 0);
      assert.ok(result.textCompleteness.sequenceAlignmentRate >= 0.7);
    });

    test('penalizes severe text truncation via critical gating factor', async () => {
      // Simulate HTML with 50 words, but audit against a pre-generated PDF containing only 5 words
      const fullHtml = `
        <h1>Rapport Complet</h1>
        <p>Un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept dix-huit dix-neuf vingt vingt-et-un vingt-deux vingt-trois vingt-quatre vingt-cinq vingt-six vingt-sept vingt-huit vingt-neuf trente.</p>
      `;

      const truncatedHtml = `<h1>Rapport Complet</h1><p>Un deux trois.</p>`;
      const generator = createPdfGenerator();
      const truncatedBuffer = await generator.generate(truncatedHtml);

      const result = await verifyRenderingQuality(fullHtml, truncatedBuffer);

      // Severe truncation should drop text recall and trigger critical gating factor
      assert.ok(result.textCompleteness.rate < 0.6);
      assert.ok(result.ssqi.criticalGatingFactor <= 0.85);
      assert.ok(result.score < 80, `Expected low score on truncated PDF, got ${result.score}`);
    });
  });

  describe('Streaming PDF Generation', () => {
    test('generateStream produces a valid readable stream of Uint8Array chunks', async () => {
      const generator = createPdfGenerator();
      const html = `<h2>Streaming Document</h2><p>Génération progressive directe en flux standard.</p>`;

      const stream = await generator.generateStream(html);
      assert.ok(stream instanceof ReadableStream);

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;

      while (!done) {
        const item = await reader.read();
        done = item.done;
        if (item.value) {
          chunks.push(item.value);
        }
      }

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      assert.ok(totalLength > 500, `Expected stream total length > 500, got ${totalLength}`);

      const merged = Buffer.concat(chunks);
      assert.strictEqual(merged.subarray(0, 5).toString('ascii'), '%PDF-');
    });

    test('renderHtmlToPdfStream produces a functional ReadableStream directly', async () => {
      const stream = await renderHtmlToPdfStream('<h1>Direct Stream Test</h1>');
      assert.ok(stream instanceof ReadableStream);

      const reader = stream.getReader();
      const { value, done } = await reader.read();
      assert.strictEqual(done, false);
      assert.ok(value !== undefined);
      assert.strictEqual(Buffer.from(value.buffer, value.byteOffset, 5).toString('ascii'), '%PDF-');
    });
  });
});
