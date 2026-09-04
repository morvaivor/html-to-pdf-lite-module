import { parentPort } from 'node:worker_threads';
import { renderHtmlToPdf } from '../htmlRenderer.js';
import type { WorkerMessage, WorkerResponse } from '../types.js';

if (parentPort) {
  parentPort.on('message', async (task: WorkerMessage) => {
    const { id, html, options } = task;
    try {
      const pdfBuffer = await renderHtmlToPdf(html, options);
      // Senior Optimization: Zero-Copy Transferable Object memory transfer
      const arrayBuffer: ArrayBuffer = (ArrayBuffer as any).transfer
        ? (ArrayBuffer as any).transfer(
            pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength),
          )
        : pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength);

      const response: WorkerResponse = { id, success: true, result: arrayBuffer };
      parentPort!.postMessage(response, [arrayBuffer]);
    } catch (err) {
      const response: WorkerResponse = { id, success: false, error: (err as Error).message };
      parentPort!.postMessage(response);
    }
  });
}
