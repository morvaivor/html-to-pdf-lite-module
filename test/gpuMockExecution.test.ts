import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GpuContext } from '../src/gpu/gpuContext.js';
import type {
  GpuAdapterLike,
  GpuBufferLike,
  GpuDeviceLike,
  GpuQueueLike,
  GpuCommandEncoderLike,
  GpuComputePassEncoderLike,
  NavigatorGpuLike,
} from '../src/gpu/gpuTypes.js';

describe('WebGPU Native Pipeline — Mocked Hardware Execution', () => {
  test('executes compute pipeline end-to-end when WebGPU device is present', async () => {
    // In-memory mock storage for buffers
    const bufferDataStore = new Map<any, Uint8Array>();

    const mockBuffer = (size: number, usage: number): GpuBufferLike => {
      const storage = new Uint8Array(size);
      const bufObj = {
        size,
        usage,
        mapAsync: async () => {},
        getMappedRange: (offset = 0, sz) => storage.buffer.slice(offset, sz !== undefined ? offset + sz : undefined),
        unmap: () => {},
        destroy: () => bufferDataStore.delete(bufObj),
      };
      bufferDataStore.set(bufObj, storage);
      return bufObj;
    };

    let submittedCommands = 0;
    const mockQueue: GpuQueueLike = {
      writeBuffer: (buf, offset, data, dataOffset = 0, size) => {
        const target = bufferDataStore.get(buf);
        if (target) {
          const src = data instanceof ArrayBuffer ? new Uint8Array(data) : (data as any);
          const len = size ?? src.byteLength;
          target.set(src.subarray(dataOffset, dataOffset + len), offset);
        }
      },
      submit: (cmds) => {
        submittedCommands += cmds.length;
      },
    };

    const mockPassEncoder: GpuComputePassEncoderLike = {
      setPipeline: () => {},
      setBindGroup: () => {},
      dispatchWorkgroups: () => {},
      end: () => {},
    };

    let copiedSize = 0;

    const mockCommandEncoder: GpuCommandEncoderLike = {
      beginComputePass: () => mockPassEncoder,
      copyBufferToBuffer: (src, srcOff, dst, dstOff, size) => {
        copiedSize = size;
        // Simulate GPU hardware copying output to staging
        const srcData = bufferDataStore.get(src);
        const dstData = bufferDataStore.get(dst);
        if (srcData && dstData) {
          dstData.set(srcData.subarray(srcOff, srcOff + size), dstOff);
        }
      },
      finish: () => ({ type: 'commandBuffer' }),
    };

    const mockDevice: GpuDeviceLike = {
      queue: mockQueue,
      createShaderModule: () => ({ type: 'shaderModule' }),
      createComputePipeline: () => ({
        type: 'computePipeline',
        getBindGroupLayout: () => ({ type: 'bindGroupLayout' }),
      }),
      createBindGroupLayout: () => ({ type: 'bindGroupLayout' }),
      createBindGroup: () => ({ type: 'bindGroup' }),
      createBuffer: (desc) => mockBuffer(desc.size, desc.usage),
      destroy: () => {},
    };

    const mockAdapter: GpuAdapterLike = {
      requestDevice: async () => mockDevice,
      info: {
        vendor: 'Simulated WebGPU Vendor',
        architecture: 'SIMD-Compute',
        device: 'Test Virtual GPU Device',
        description: 'Mocked WebGPU Hardware',
      },
    };

    const mockNavigatorGpu: NavigatorGpuLike = {
      requestAdapter: async () => mockAdapter,
    };

    // Inject mock into globalThis.navigator.gpu
    const originalGpuDesc = Object.getOwnPropertyDescriptor(globalThis.navigator, 'gpu');
    Object.defineProperty(globalThis.navigator, 'gpu', {
      value: mockNavigatorGpu,
      configurable: true,
      writable: true,
    });

    try {
      GpuContext.resetInstance();
      const context = GpuContext.getInstance();
      const initialized = await context.initialize();

      assert.equal(initialized, true);
      assert.equal(context.isAvailable, true);

      const statsBefore = context.getStats();
      assert.equal(statsBefore.available, true);
      assert.equal(statsBefore.adapterName, 'Mocked WebGPU Hardware');

      // Run reduction for 2 rows x 3 cols
      const rowCount = 2;
      const maxCols = 3;
      const borderWidth = 1;
      const cellHeights = new Float32Array([10, 25, 12, 30, 5, 18]);

      // Fill mock output buffer with expected max values so readback gets the result
      // Row 0: max(10, 25, 12) + 1 = 26
      // Row 1: max(30, 5, 18) + 1 = 31
      // In actual GPU execution, the WGSL shader writes this; here we simulate the shader write:
      const expectedRowHeights = new Float32Array([26, 31]);

      // Hook mockCommandEncoder to populate output before copy
      const origCopy = mockCommandEncoder.copyBufferToBuffer.bind(mockCommandEncoder);
      mockCommandEncoder.copyBufferToBuffer = (src, srcOff, dst, dstOff, size) => {
        const srcData = bufferDataStore.get(src);
        if (srcData) {
          new Float32Array(srcData.buffer).set(expectedRowHeights);
        }
        origCopy(src, srcOff, dst, dstOff, size);
      };

      (mockDevice as any).createCommandEncoder = () => mockCommandEncoder;

      const result = await context.tableRowReduce(cellHeights, rowCount, maxCols, borderWidth);

      assert.equal(result.length, rowCount);
      assert.equal(result[0], 26);
      assert.equal(result[1], 31);
      assert.ok(submittedCommands >= 1);
      assert.equal(copiedSize, rowCount * Float32Array.BYTES_PER_ELEMENT);

      const statsAfter = context.getStats();
      assert.equal(statsAfter.tablesProcessedGpu, 1);
      assert.ok(statsAfter.gpuKernelTimeMs >= 0);
      assert.ok(statsAfter.gpuUploadTimeMs >= 0);
      assert.ok(statsAfter.gpuReadbackTimeMs >= 0);

      await context.dispose();
      assert.equal(context.isAvailable, false);
    } finally {
      if (originalGpuDesc) {
        Object.defineProperty(globalThis.navigator, 'gpu', originalGpuDesc);
      } else {
        delete (globalThis.navigator as any).gpu;
      }
      GpuContext.resetInstance();
    }
  });
});
