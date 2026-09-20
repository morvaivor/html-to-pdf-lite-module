import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetCache } from '../src/core/assetCache.js';

describe('Patch 04: AssetCache (Cross-PDF Asset Caching & Coalescing)', () => {
  test('repeated requests hit cache without re-invoking loader', async () => {
    const cache = new AssetCache({ maxImages: 10 });
    let loadCount = 0;
    const testBuf = Buffer.from('image-data-123');

    const loader = async () => {
      loadCount++;
      return testBuf;
    };

    const res1 = await cache.getImage('http://example.com/logo.png', loader);
    const res2 = await cache.getImage('http://example.com/logo.png', loader);

    assert.equal(loadCount, 1, 'Loader should only be called once for cached resource');
    assert.deepEqual(res1, testBuf);
    assert.deepEqual(res2, testBuf);
    assert.equal(cache.imageCount, 1);
  });

  test('concurrent requests share one in-flight Promise (request coalescing)', async () => {
    const cache = new AssetCache({ maxImages: 10 });
    let loadCount = 0;

    const slowLoader = async () => {
      loadCount++;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return Buffer.from('slow-loaded-buffer');
    };

    // Trigger 5 concurrent requests simultaneously for the exact same resource
    const [b1, b2, b3, b4, b5] = await Promise.all([
      cache.getImage('http://example.com/shared.png', slowLoader),
      cache.getImage('http://example.com/shared.png', slowLoader),
      cache.getImage('http://example.com/shared.png', slowLoader),
      cache.getImage('http://example.com/shared.png', slowLoader),
      cache.getImage('http://example.com/shared.png', slowLoader),
    ]);

    assert.equal(loadCount, 1, 'Coalescing must invoke the loader exactly once for concurrent requests');
    assert.equal(b1.toString(), 'slow-loaded-buffer');
    assert.equal(b2.toString(), 'slow-loaded-buffer');
    assert.equal(b3.toString(), 'slow-loaded-buffer');
    assert.equal(b4.toString(), 'slow-loaded-buffer');
    assert.equal(b5.toString(), 'slow-loaded-buffer');
    assert.equal(cache.inFlightImageCount, 0, 'In-flight map must be empty after completion');
  });

  test('rejected loads are removed from in-flight map and can be retried', async () => {
    const cache = new AssetCache();
    let shouldFail = true;

    const flakeyLoader = async () => {
      if (shouldFail) {
        throw new Error('Network timeout');
      }
      return Buffer.from('success-buffer');
    };

    // First attempt fails
    await assert.rejects(() => cache.getImage('http://example.com/flakey.png', flakeyLoader), /Network timeout/);
    assert.equal(cache.inFlightImageCount, 0, 'In-flight map must be cleared on failure');
    assert.equal(cache.hasImage('http://example.com/flakey.png'), false);

    // Second attempt succeeds
    shouldFail = false;
    const res = await cache.getImage('http://example.com/flakey.png', flakeyLoader);
    assert.equal(res.toString(), 'success-buffer');
    assert.equal(cache.hasImage('http://example.com/flakey.png'), true);
  });

  test('different font variants do not collide with same URL', async () => {
    const cache = new AssetCache();
    const url = 'http://example.com/OpenSans.ttf';

    const keyNormal = AssetCache.buildFontKey(url, false, false);
    const keyBold = AssetCache.buildFontKey(url, true, false);
    const keyItalic = AssetCache.buildFontKey(url, false, true);
    const keyBoldItalic = AssetCache.buildFontKey(url, true, true);

    assert.notEqual(keyNormal, keyBold);
    assert.notEqual(keyNormal, keyItalic);
    assert.notEqual(keyBold, keyBoldItalic);

    await cache.getFont(keyNormal, async () => Buffer.from('normal'));
    await cache.getFont(keyBold, async () => Buffer.from('bold'));
    await cache.getFont(keyItalic, async () => Buffer.from('italic'));
    await cache.getFont(keyBoldItalic, async () => Buffer.from('bold-italic'));

    assert.equal(cache.fontCount, 4);
    assert.equal((await cache.getFont(keyNormal, async () => Buffer.from('x'))).toString(), 'normal');
    assert.equal((await cache.getFont(keyBold, async () => Buffer.from('x'))).toString(), 'bold');
  });

  test('bounded eviction works when maxSize is reached', async () => {
    const cache = new AssetCache({ maxImages: 2 });

    await cache.getImage('img1', async () => Buffer.from('1'));
    await cache.getImage('img2', async () => Buffer.from('2'));
    assert.equal(cache.imageCount, 2);

    // Adding 3rd evicts img1
    await cache.getImage('img3', async () => Buffer.from('3'));
    assert.equal(cache.imageCount, 2);
    assert.equal(cache.hasImage('img1'), false);
    assert.equal(cache.hasImage('img2'), true);
    assert.equal(cache.hasImage('img3'), true);
  });
});
