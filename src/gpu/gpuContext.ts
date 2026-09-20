import {
  type GpuAdapterLike,
  type GpuBufferLike,
  type GpuDeviceLike,
  type GpuStats,
  type NavigatorGpuLike,
  GPU_BUFFER_USAGE,
  GPU_MAP_MODE,
} from './gpuTypes.js';
import { TABLE_ROW_REDUCE_WGSL } from './shaders/tableRowReduce.wgsl.js';

interface PooledBuffer {
  buffer: GpuBufferLike;
  size: number;
}

export class GpuContext {
  private static instance: GpuContext | null = null;

  private adapter: GpuAdapterLike | null = null;
  private device: GpuDeviceLike | null = null;
  private initPromise: Promise<boolean> | null = null;
  private reducePipeline: unknown = null;

  // Reusable buffer pools to prevent per-table VRAM allocations
  private uniformBuffer: GpuBufferLike | null = null;
  private storageInputPool: PooledBuffer[] = [];
  private storageOutputPool: PooledBuffer[] = [];
  private stagingReadPool: PooledBuffer[] = [];

  // Metrics tracking
  private stats: GpuStats = {
    available: false,
    adapterName: null,
    tablesProcessedGpu: 0,
    tablesProcessedCpu: 0,
    gpuKernelTimeMs: 0,
    gpuUploadTimeMs: 0,
    gpuReadbackTimeMs: 0,
    fallbacks: 0,
  };

  static getInstance(): GpuContext {
    if (!GpuContext.instance) {
      GpuContext.instance = new GpuContext();
    }
    return GpuContext.instance;
  }

  static resetInstance(): void {
    if (GpuContext.instance) {
      void GpuContext.instance.dispose();
      GpuContext.instance = null;
    }
  }

  /**
   * Initializes the native WebGPU adapter and device if available.
   * Checks `globalThis.navigator.gpu` (native W3C standard) first, then falls back to optional module.
   */
  async initialize(): Promise<boolean> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        let gpu: NavigatorGpuLike | null = (globalThis as any).navigator?.gpu ?? null;

        if (!gpu) {
          try {
            // Dynamic import of optional 'webgpu' binding without hard dependency
            const modName = 'webgpu';
            const webgpuMod = await import(modName);
            gpu = webgpuMod.create?.([]) ?? webgpuMod.gpu ?? webgpuMod.default?.gpu ?? null;
          } catch {
            gpu = null;
          }
        }

        if (!gpu || typeof gpu.requestAdapter !== 'function') {
          return false;
        }

        const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) {
          return false;
        }

        const device = await adapter.requestDevice();
        if (!device) {
          return false;
        }

        this.adapter = adapter;
        this.device = device;
        this.stats = {
          ...this.stats,
          available: true,
          adapterName: adapter.info?.description || adapter.info?.device || 'Native WebGPU Adapter',
        };

        // Precompile WGSL compute shader and pipeline once
        const shaderModule = device.createShaderModule({ code: TABLE_ROW_REDUCE_WGSL });
        this.reducePipeline = device.createComputePipeline({
          layout: 'auto',
          compute: {
            module: shaderModule,
            entryPoint: 'main',
          },
        });

        // Preallocate persistent uniform buffer (16 bytes: 4 x 4-byte values)
        this.uniformBuffer = device.createBuffer({
          size: 16,
          usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });

        return true;
      } catch {
        this.device = null;
        this.adapter = null;
        return false;
      }
    })();

    return this.initPromise;
  }

  get isAvailable(): boolean {
    return Boolean(this.device && this.reducePipeline);
  }

  get currentAdapter(): GpuAdapterLike | null {
    return this.adapter;
  }

  getStats(): GpuStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      ...this.stats,
      tablesProcessedGpu: 0,
      tablesProcessedCpu: 0,
      gpuKernelTimeMs: 0,
      gpuUploadTimeMs: 0,
      gpuReadbackTimeMs: 0,
      fallbacks: 0,
    };
  }

  recordCpuTable(): void {
    this.stats = {
      ...this.stats,
      tablesProcessedCpu: this.stats.tablesProcessedCpu + 1,
    };
  }

  recordFallback(): void {
    this.stats = {
      ...this.stats,
      fallbacks: this.stats.fallbacks + 1,
    };
  }

  /**
   * Helper to round byte size up to power of 2 (min 256 bytes) to minimize reallocations
   */
  private roundBufferSize(minBytes: number): number {
    let size = 256;
    while (size < minBytes) {
      size *= 2;
    }
    return size;
  }

  private getOrCreateBuffer(pool: PooledBuffer[], requiredBytes: number, usage: number): GpuBufferLike {
    const rounded = this.roundBufferSize(requiredBytes);
    const existing = pool.find((p) => p.size >= rounded);
    if (existing) {
      return existing.buffer;
    }

    const newBuffer = this.device!.createBuffer({
      size: rounded,
      usage,
    });
    pool.push({ buffer: newBuffer, size: rounded });
    return newBuffer;
  }

  /**
   * Executes the `tableRowReduce.wgsl` compute shader on WebGPU.
   */
  async tableRowReduce(
    cellHeights: Float32Array,
    rowCount: number,
    maxCols: number,
    borderWidth: number,
  ): Promise<Float32Array> {
    if (!this.device || !this.reducePipeline) {
      throw new Error('WebGPU device not initialized');
    }

    const device = this.device;
    const queue = device.queue;

    const tUploadStart = performance.now();

    // 1. Upload Uniforms (16 bytes)
    const uniformsData = new Uint32Array(4);
    uniformsData[0] = rowCount;
    uniformsData[1] = maxCols;
    new Float32Array(uniformsData.buffer)[2] = borderWidth;
    uniformsData[3] = 0; // padding to 16-byte alignment
    queue.writeBuffer(this.uniformBuffer!, 0, uniformsData.buffer);

    // 2. Prepare Storage Input Buffer (cellHeights)
    const inputByteSize = cellHeights.byteLength;
    const inputBuffer = this.getOrCreateBuffer(
      this.storageInputPool,
      inputByteSize,
      GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
    );
    queue.writeBuffer(inputBuffer, 0, cellHeights.buffer, cellHeights.byteOffset, inputByteSize);

    // 3. Prepare Storage Output Buffer (rowHeights) & Staging Readback Buffer
    const outputByteSize = rowCount * Float32Array.BYTES_PER_ELEMENT;
    const outputBuffer = this.getOrCreateBuffer(
      this.storageOutputPool,
      outputByteSize,
      GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
    );

    const stagingBuffer = this.getOrCreateBuffer(
      this.stagingReadPool,
      outputByteSize,
      GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
    );

    const uploadMs = performance.now() - tUploadStart;

    // 4. Dispatch Compute Shader
    const tKernelStart = performance.now();
    const commandEncoder = (device as any).createCommandEncoder();

    // Bind group creation with pipeline layout
    const bindGroup = device.createBindGroup({
      layout: (this.reducePipeline as any).getBindGroupLayout?.(0) ?? (this.reducePipeline as any).bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: inputBuffer } },
        { binding: 2, resource: { buffer: outputBuffer } },
      ],
    });

    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.reducePipeline);
    passEncoder.setBindGroup(0, bindGroup);

    // Workgroup size is 64 threads per workgroup
    const workgroupCountX = Math.ceil(rowCount / 64);
    passEncoder.dispatchWorkgroups(workgroupCountX);
    passEncoder.end();

    // Copy result from storage buffer to staging buffer for readback
    commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, outputByteSize);
    queue.submit([commandEncoder.finish()]);

    const kernelMs = performance.now() - tKernelStart;

    // 5. Readback from GPU to Host Memory
    const tReadbackStart = performance.now();
    await stagingBuffer.mapAsync(GPU_MAP_MODE.READ, 0, outputByteSize);
    const mappedRange = stagingBuffer.getMappedRange(0, outputByteSize);
    const result = new Float32Array(mappedRange.slice(0, outputByteSize));
    stagingBuffer.unmap();

    const readbackMs = performance.now() - tReadbackStart;

    // Record stats
    this.stats = {
      ...this.stats,
      tablesProcessedGpu: this.stats.tablesProcessedGpu + 1,
      gpuUploadTimeMs: this.stats.gpuUploadTimeMs + uploadMs,
      gpuKernelTimeMs: this.stats.gpuKernelTimeMs + kernelMs,
      gpuReadbackTimeMs: this.stats.gpuReadbackTimeMs + readbackMs,
    };

    return result;
  }

  async dispose(): Promise<void> {
    for (const p of this.storageInputPool) p.buffer.destroy();
    for (const p of this.storageOutputPool) p.buffer.destroy();
    for (const p of this.stagingReadPool) p.buffer.destroy();
    this.storageInputPool = [];
    this.storageOutputPool = [];
    this.stagingReadPool = [];

    if (this.uniformBuffer) {
      this.uniformBuffer.destroy();
      this.uniformBuffer = null;
    }

    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
    this.adapter = null;
    this.reducePipeline = null;
    this.initPromise = null;
    this.stats = {
      ...this.stats,
      available: false,
    };
  }
}

export function getGpuContext(): GpuContext {
  return GpuContext.getInstance();
}
