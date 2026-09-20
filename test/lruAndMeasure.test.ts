import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { LruCache } from '../src/core/lruCache.js';
import { TextMeasureCache } from '../src/core/cacheManager.js';

describe('Patch 01 & 02: LruCache and TextMeasureCache', () => {
  describe('LruCache<K, V>', () => {
    test('enforces maxSize and evicts least-recently-used item', () => {
      const cache = new LruCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      assert.equal(cache.size, 3);
      assert.equal(cache.get('a'), 1); // access 'a' -> recency order: b, c, a

      cache.set('d', 4); // should evict 'b'
      assert.equal(cache.size, 3);
      assert.equal(cache.has('b'), false, 'b should have been evicted');
      assert.equal(cache.get('a'), 1);
      assert.equal(cache.get('c'), 3);
      assert.equal(cache.get('d'), 4);
    });

    test('updating existing key updates value and promotes recency without increasing size', () => {
      const cache = new LruCache<string, string>(2);
      cache.set('x', 'first');
      cache.set('y', 'second');

      cache.set('x', 'updated'); // promotes 'x', size still 2
      assert.equal(cache.size, 2);
      assert.equal(cache.get('x'), 'updated');

      cache.set('z', 'third'); // should evict 'y' (not 'x')
      assert.equal(cache.has('y'), false, 'y should have been evicted');
      assert.equal(cache.has('x'), true);
      assert.equal(cache.has('z'), true);
    });

    test('delete, clear, and iterators behave correctly', () => {
      const cache = new LruCache<string, number>(5);
      cache.set('one', 1);
      cache.set('two', 2);
      cache.set('three', 3);

      assert.equal(cache.delete('two'), true);
      assert.equal(cache.delete('nonexistent'), false);
      assert.equal(cache.size, 2);

      const keys = Array.from(cache.keys());
      assert.deepEqual(keys, ['one', 'three']);

      cache.clear();
      assert.equal(cache.size, 0);
      assert.equal(cache.get('one'), undefined);
    });

    test('throws if maxSize <= 0', () => {
      assert.throws(() => new LruCache(0), /must be greater than 0/);
      assert.throws(() => new LruCache(-5), /must be greater than 0/);
    });
  });

  describe('TextMeasureCache (Patch 01)', () => {
    test('two same-length strings with different content never collide', () => {
      const doc = new PDFDocument({ autoFirstPage: false });
      const cache = new TextMeasureCache(10);

      // Create two distinct strings of exactly 120 characters
      const str1 = 'A'.repeat(50) + 'MIDDLE_ONE' + 'Z'.repeat(60);
      const str2 = 'A'.repeat(50) + 'MIDDLE_TWO' + 'Z'.repeat(60);

      assert.equal(str1.length, str2.length);
      assert.notEqual(str1, str2);

      const height1 = cache.measure(doc, str1, 'Helvetica', 12, 300);
      const height2 = cache.measure(doc, str2, 'Helvetica', 12, 300);

      assert.equal(cache.cache.size, 2, 'Both strings must have distinct cache entries');
      assert.equal(typeof height1, 'number');
      assert.equal(typeof height2, 'number');
    });

    test('measurement result remains identical with and without caching', () => {
      const doc = new PDFDocument({ autoFirstPage: false });
      const cache = new TextMeasureCache(50);
      const text = 'Testing measurement consistency with PDFKit native calculation.';

      doc.font('Helvetica').fontSize(14);
      const directHeight = doc.heightOfString(text, { width: 250, lineGap: 14 * 0.15 });

      const cachedHeight1 = cache.measure(doc, text, 'Helvetica', 14, 250);
      const cachedHeight2 = cache.measure(doc, text, 'Helvetica', 14, 250);

      assert.equal(cachedHeight1, directHeight);
      assert.equal(cachedHeight2, directHeight);
    });

    test('repeated access promotes entry and oldest unused entry is evicted', () => {
      const doc = new PDFDocument({ autoFirstPage: false });
      const cache = new TextMeasureCache(3);

      cache.measure(doc, 'Item 1', 'Helvetica', 12, 200);
      cache.measure(doc, 'Item 2', 'Helvetica', 12, 200);
      cache.measure(doc, 'Item 3', 'Helvetica', 12, 200);

      assert.equal(cache.cache.size, 3);

      // Re-access Item 1 to promote it to most recently used
      cache.measure(doc, 'Item 1', 'Helvetica', 12, 200);

      // Adding Item 4 should evict Item 2 (since Item 1 was promoted)
      cache.measure(doc, 'Item 4', 'Helvetica', 12, 200);
      assert.equal(cache.cache.size, 3);

      // Check keys
      const keys = Array.from(cache.cache.keys());
      assert.ok(
        keys.some((k) => k.includes('Item 1')),
        'Item 1 should still be present',
      );
      assert.ok(
        keys.some((k) => k.includes('Item 3')),
        'Item 3 should still be present',
      );
      assert.ok(
        keys.some((k) => k.includes('Item 4')),
        'Item 4 should still be present',
      );
      assert.ok(!keys.some((k) => k.includes('Item 2')), 'Item 2 should have been evicted');
    });
  });
});
