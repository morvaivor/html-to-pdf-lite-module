import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpus, availableParallelism } from 'node:os';
import { createPdfGenerator } from '../src/index.js';
import { calculateMaxWorkers } from '../src/workers/workerPool.js';

describe('WorkerPool & Elastic On-Demand Scaling', () => {
  test('calculateMaxWorkers caps at 50% CPU cores by default (Moderate Mode)', () => {
    const totalCores = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
    const expectedWorkers = Math.max(1, Math.floor(totalCores * 0.5));

    const calculated = calculateMaxWorkers(0.5);
    assert.equal(calculated, expectedWorkers);
  });

  test('calculateMaxWorkers respects custom ratio (e.g. 80%)', () => {
    const totalCores = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
    assert.equal(calculateMaxWorkers(0.8), Math.max(1, Math.floor(totalCores * 0.8)));
  });

  test('PdfGenerator starts with 0 workers on demand', () => {
    const gen = createPdfGenerator({
      useWorkerPool: true,
      cpuRatio: 0.5,
    });

    const stats = gen.getWorkerStats();
    assert.equal(stats.totalWorkers, 0);
    assert.equal(stats.activeTasks, 0);
    assert.ok(stats.maxWorkers >= 1);
  });

  test('WorkerPool spawns workers dynamically on demand and returns stats', async () => {
    const generator = createPdfGenerator({
      useWorkerPool: true,
      cpuRatio: 0.5,
    });

    const html = '<h1>Elastic Worker Test</h1><p>Test paragraph</p>';
    const buffer = await generator.generate(html);

    assert.ok(buffer instanceof Buffer);
    assert.ok(buffer.length > 0);

    const stats = generator.getWorkerStats();
    assert.ok(stats.totalWorkers >= 1);

    await generator.terminateWorkerPool();
  });

  test('WorkerPool handles concurrent PDF generation tasks dynamically', async () => {
    const generator = createPdfGenerator({
      useWorkerPool: true,
      cpuRatio: 0.5,
    });

    const tasks = Array.from({ length: 10 }, (_, i) =>
      generator.generate(`<h1>Concurrent Doc ${i}</h1><p>Content for doc ${i}</p>`)
    );

    const buffers = await Promise.all(tasks);
    assert.equal(buffers.length, 10);
    for (const buf of buffers) {
      assert.ok(buf instanceof Buffer);
      assert.ok(buf.toString('latin1').startsWith('%PDF'));
    }

    await generator.terminateWorkerPool();
  });

  test('WorkerPool auto-terminates idle workers after idleTimeoutMs', async () => {
    const generator = createPdfGenerator({
      useWorkerPool: true,
      idleTimeoutMs: 100, // 100ms fast idle timeout for testing
    });

    await generator.generate('<h1>Fast Idle Test</h1>');
    assert.ok(generator.getWorkerStats().totalWorkers >= 1);

    // Wait for idle timeout (100ms + 50ms buffer)
    await new Promise(r => setTimeout(r, 200));

    const statsAfterIdle = generator.getWorkerStats();
    assert.equal(statsAfterIdle.totalWorkers, 0);

    await generator.terminateWorkerPool();
  });
});
