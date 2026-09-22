/**
 * Lightweight native WebGPU micro-interfaces.
 * Compliant with W3C WebGPU specification for headless compute pipelines
 * without requiring @webgpu/types or external dependencies.
 */

export type GpuMode = boolean | 'auto';

export interface GpuStats {
  readonly available: boolean;
  readonly adapterName: string | null;
  readonly tablesProcessedGpu: number;
  readonly tablesProcessedCpu: number;
  readonly gpuKernelTimeMs: number;
  readonly gpuUploadTimeMs: number;
  readonly gpuReadbackTimeMs: number;
  readonly fallbacks: number;
}

export interface GpuBufferLike {
  readonly size: number;
  readonly usage: number;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface GpuQueueLike {
  writeBuffer(
    buffer: GpuBufferLike,
    bufferOffset: number,
    data: BufferSource | SharedArrayBuffer,
    dataOffset?: number,
    size?: number,
  ): void;
  submit(commandBuffers: readonly unknown[]): void;
}

export interface GpuComputePassEncoderLike {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(workgroupCountX: number, workgroupCountY?: number, workgroupCountZ?: number): void;
  end(): void;
}

export interface GpuCommandEncoderLike {
  beginComputePass(descriptor?: unknown): GpuComputePassEncoderLike;
  copyBufferToBuffer(
    source: GpuBufferLike,
    sourceOffset: number,
    destination: GpuBufferLike,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): unknown;
}

export interface GpuDeviceLike {
  readonly queue: GpuQueueLike;
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipeline(descriptor: {
    layout: 'auto' | unknown;
    compute: { module: unknown; entryPoint: string };
  }): unknown;
  createBindGroupLayout(descriptor: unknown): unknown;
  createBindGroup(descriptor: {
    layout: unknown;
    entries: readonly { binding: number; resource: { buffer: GpuBufferLike } | unknown }[];
  }): unknown;
  createBuffer(descriptor: { size: number; usage: number; mappedAtCreation?: boolean }): GpuBufferLike;
  destroy(): void;
}

export interface GpuAdapterLike {
  requestDevice(descriptor?: unknown): Promise<GpuDeviceLike | null>;
  readonly info?: {
    readonly vendor?: string;
    readonly architecture?: string;
    readonly device?: string;
    readonly description?: string;
  };
}

export interface NavigatorGpuLike {
  requestAdapter(options?: {
    powerPreference?: 'low-power' | 'high-performance';
    forceFallbackAdapter?: boolean;
  }): Promise<GpuAdapterLike | null>;
}

/** WebGPU Buffer Usage Constants (W3C WebGPU specification) */
export const GPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
} as const;

/** WebGPU Map Mode Constants */
export const GPU_MAP_MODE = {
  READ: 0x0001,
  WRITE: 0x0002,
} as const;
