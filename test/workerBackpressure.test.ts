import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerPool, WorkerPoolBusyError } from '../src/workers/workerPool.js';

describe('Patches 08 & 09 — Worker Backpressure and Warm Worker Floor', () => {
  test('Patch 09: pre-spawns minWorkers on pool creation', async () => {
    const pool = new WorkerPool({
      minWorkers: 2,
      maxWorkers: 4,
      idleTimeoutMs: 500,
    });

    try {
      const stats = pool.getStats();
      assert.equal(stats.totalWorkers, 2);
      assert.equal(stats.freeWorkers, 2);
      assert.equal(stats.minWorkers, 2);
      assert.equal(stats.maxWorkers, 4);
    } finally {
      await pool.terminate();
    }
  });

  test('Patch 09: preserves warm worker floor after idle timeout', async () => {
    const pool = new WorkerPool({
      minWorkers: 1,
      maxWorkers: 3,
      idleTimeoutMs: 50,
    });

    try {
      assert.equal(pool.getStats().totalWorkers, 1);

      // Run a simple generation
      const buf = await pool.runTask('<h1>Warm worker test</h1>');
      assert.ok(buf instanceof Buffer);
      assert.ok(buf.length > 0);

      // Wait for idle timeout to fire
      await new Promise((resolve) => setTimeout(resolve, 120));

      // Worker count must not drop below minWorkers = 1
      const stats = pool.getStats();
      assert.equal(stats.totalWorkers, 1);
      assert.equal(stats.freeWorkers, 1);
    } finally {
      await pool.terminate();
    }
  });

  test('Patch 08: rejects with WorkerPoolBusyError when queue limit is exceeded', async () => {
    const pool = new WorkerPool({
      maxWorkers: 1,
      minWorkers: 0,
      maxQueueSize: 2,
    });

    try {
      // Dispatch 1 task (active) + 2 tasks (fills maxQueueSize: 2)
      const p1 = pool.runTask('<div>Task 1</div>');
      const p2 = pool.runTask('<div>Task 2</div>');
      const p3 = pool.runTask('<div>Task 3</div>');

      // 4th task should be rejected immediately due to queue saturation
      await assert.rejects(
        async () => {
          await pool.runTask('<div>Task 4 overflow</div>');
        },
        (err: unknown) => {
          assert.ok(err instanceof WorkerPoolBusyError);
          assert.match((err as Error).message, /queue is full/i);
          return true;
        },
      );

      // The queued tasks should complete normally
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      assert.ok(r1 instanceof Buffer);
      assert.ok(r2 instanceof Buffer);
      assert.ok(r3 instanceof Buffer);
    } finally {
      await pool.terminate();
    }
  });

  test('Patch 08: rejected tasks do not leak into queue depth', async () => {
    const pool = new WorkerPool({
      maxWorkers: 1,
      minWorkers: 0,
      maxQueueSize: 1,
    });

    try {
      const p1 = pool.runTask('<div>Active</div>');
      const p2 = pool.runTask('<div>Queued</div>');

      assert.equal(pool.getStats().queuedTasks, 1);

      // Try 3 overflow tasks
      for (let i = 0; i < 3; i++) {
        await assert.rejects(async () => pool.runTask('<div>Rejected</div>'), WorkerPoolBusyError);
      }

      // Queue depth must still be exactly 1
      assert.equal(pool.getStats().queuedTasks, 1);

      await Promise.all([p1, p2]);
      assert.equal(pool.getStats().queuedTasks, 0);
    } finally {
      await pool.terminate();
    }
  });
});
