import { type GpuContext, getGpuContext } from './gpuContext.js';
import type { GpuMode, GpuStats } from './gpuTypes.js';
import { tableRowReduceCpu } from './tableRowReduceCpu.js';

/**
 * Empirical threshold: tables smaller than this cell count execute faster on CPU
 * due to PCIe transfer and GPU submission overhead.
 */
export const GPU_TABLE_MIN_CELLS = 4096;

export class GpuAccelerator {
  private readonly context: GpuContext;

  constructor(context: GpuContext = getGpuContext()) {
    this.context = context;
  }

  /**
   * Computes maximum cell heights for all table rows.
   * Dynamically chooses between GPU Compute Shader (WGSL) and optimized CPU reduction
   * based on the table cell count and runtime GPU availability.
   */
  async tableRowReduce(
    cellHeights: Float32Array,
    rowCount: number,
    maxCols: number,
    borderWidth: number,
    mode: GpuMode = 'auto',
  ): Promise<Float32Array> {
    const totalCells = cellHeights.length;

    // Fast-path: CPU execution if GPU explicitly disabled or table below crossover threshold
    if (mode === false || totalCells < GPU_TABLE_MIN_CELLS) {
      this.context.recordCpuTable();
      return tableRowReduceCpu(cellHeights, rowCount, maxCols, borderWidth);
    }

    // Try GPU execution with automatic fallback
    const isAvailable = await this.context.initialize();
    if (!isAvailable) {
      this.context.recordCpuTable();
      return tableRowReduceCpu(cellHeights, rowCount, maxCols, borderWidth);
    }

    try {
      return await this.context.tableRowReduce(cellHeights, rowCount, maxCols, borderWidth);
    } catch {
      this.context.recordFallback();
      return tableRowReduceCpu(cellHeights, rowCount, maxCols, borderWidth);
    }
  }

  getStats(): GpuStats {
    return this.context.getStats();
  }

  resetStats(): void {
    this.context.resetStats();
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }
}

export const gpuAccelerator: GpuAccelerator = new GpuAccelerator();
