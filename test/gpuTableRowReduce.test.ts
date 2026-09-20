import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tableRowReduceCpu, gpuAccelerator, GPU_TABLE_MIN_CELLS } from '../src/index.js';

describe('WebGPU & CPU — Table Row Height Reduction Parity', () => {
  test('tableRowReduceCpu correctly computes row max heights with borders', () => {
    // 3 rows x 4 columns
    const rowCount = 3;
    const maxCols = 4;
    const borderWidth = 2;

    // Row 0: 10, 15, 8, 12 -> max 15 + 2 = 17
    // Row 1: 20, 5, 0, 25  -> max 25 + 2 = 27
    // Row 2: 7, 7, 7, 7    -> max 7 + 2 = 9
    const cellHeights = new Float32Array([10, 15, 8, 12, 20, 5, 0, 25, 7, 7, 7, 7]);

    const result = tableRowReduceCpu(cellHeights, rowCount, maxCols, borderWidth);
    assert.equal(result.length, 3);
    assert.equal(result[0], 17);
    assert.equal(result[1], 27);
    assert.equal(result[2], 9);
  });

  test('tableRowReduceCpu handles decimals and zero border width', () => {
    const rowCount = 2;
    const maxCols = 2;
    const cellHeights = new Float32Array([14.35, 28.75, 0.0, 9.5]);

    const result = tableRowReduceCpu(cellHeights, rowCount, maxCols, 0);
    assert.equal(result.length, 2);
    assert.ok(Math.abs(result[0]! - 28.75) < 0.001);
    assert.ok(Math.abs(result[1]! - 9.5) < 0.001);
  });

  test('gpuAccelerator.tableRowReduce routes small tables (< 4096 cells) to CPU fast-path', async () => {
    gpuAccelerator.resetStats();

    const rowCount = 10;
    const maxCols = 5; // 50 cells < 4096 threshold
    const cellHeights = new Float32Array(rowCount * maxCols);
    for (let i = 0; i < cellHeights.length; i++) {
      cellHeights[i] = (i % 10) + 1;
    }

    const result = await gpuAccelerator.tableRowReduce(cellHeights, rowCount, maxCols, 1, 'auto');
    assert.equal(result.length, rowCount);

    const stats = gpuAccelerator.getStats();
    assert.ok(stats.tablesProcessedCpu >= 1);
  });

  test('gpuAccelerator.tableRowReduce processes large tables (>= 4096 cells) with parity', async () => {
    // 500 rows x 10 cols = 5000 cells >= 4096 threshold
    const rowCount = 500;
    const maxCols = 10;
    const cellHeights = new Float32Array(rowCount * maxCols);

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < maxCols; c++) {
        cellHeights[r * maxCols + c] = (r * 3 + c * 7) % 50;
      }
    }

    const cpuExpected = tableRowReduceCpu(cellHeights, rowCount, maxCols, 1.5);
    const result = await gpuAccelerator.tableRowReduce(cellHeights, rowCount, maxCols, 1.5, 'auto');

    assert.equal(result.length, rowCount);
    for (let r = 0; r < rowCount; r++) {
      assert.ok(
        Math.abs(result[r]! - cpuExpected[r]!) < 0.001,
        `Mismatch at row ${r}: got ${result[r]}, expected ${cpuExpected[r]}`,
      );
    }
  });

  test('GPU_TABLE_MIN_CELLS is set to 4096', () => {
    assert.equal(GPU_TABLE_MIN_CELLS, 4096);
  });
});
