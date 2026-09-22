import { parentPort } from 'node:worker_threads';
import { renderHtmlToPdf } from '../htmlRenderer.js';
import type { WorkerMessage, WorkerResponse, ProfilingTimings, GpuStats } from '../types.js';
import { gpuAccelerator } from '../gpu/gpuAccelerator.js';

if (parentPort) {
  parentPort.on('message', async (task: WorkerMessage) => {
    const { id, html, options } = task;
    try {
      let capturedTimings: ProfilingTimings | undefined;
      const effectiveOptions = options.profiling
        ? {
            ...options,
            onProfile: (t: ProfilingTimings) => {
              capturedTimings = t;
            },
          }
        : options;

      const statsBefore = gpuAccelerator.getStats();
      const pdfBuffer = await renderHtmlToPdf(html, effectiveOptions);
      const statsAfter = gpuAccelerator.getStats();

      const deltaGpuStats: GpuStats = {
        available: statsAfter.available,
        adapterName: statsAfter.adapterName,
        tablesProcessedGpu: statsAfter.tablesProcessedGpu - statsBefore.tablesProcessedGpu,
        tablesProcessedCpu: statsAfter.tablesProcessedCpu - statsBefore.tablesProcessedCpu,
        gpuKernelTimeMs: statsAfter.gpuKernelTimeMs - statsBefore.gpuKernelTimeMs,
        gpuUploadTimeMs: statsAfter.gpuUploadTimeMs - statsBefore.gpuUploadTimeMs,
        gpuReadbackTimeMs: statsAfter.gpuReadbackTimeMs - statsBefore.gpuReadbackTimeMs,
        fallbacks: statsAfter.fallbacks - statsBefore.fallbacks,
      };

      // True Zero-Copy Transferable Object memory transfer
      const rawArrayBuffer: ArrayBuffer =
        pdfBuffer.byteOffset === 0 && pdfBuffer.byteLength === pdfBuffer.buffer.byteLength
          ? (pdfBuffer.buffer as ArrayBuffer)
          : (pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength) as ArrayBuffer);

      const arrayBuffer: ArrayBuffer = (ArrayBuffer as any).transfer
        ? (ArrayBuffer as any).transfer(rawArrayBuffer)
        : rawArrayBuffer;

      const response: WorkerResponse = {
        id,
        success: true,
        result: arrayBuffer,
        gpuStats: deltaGpuStats,
        profilingTimings: capturedTimings,
      };
      parentPort!.postMessage(response, [arrayBuffer]);
    } catch (err) {
      const response: WorkerResponse = { id, success: false, error: (err as Error).message };
      parentPort!.postMessage(response);
    }
  });
}
