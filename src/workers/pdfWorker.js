import { parentPort } from 'node:worker_threads';
import { renderHtmlToPdf } from '../htmlRenderer.js';

if (parentPort) {
  parentPort.on('message', async (task) => {
    const { id, html, options } = task;
    try {
      const pdfBuffer = await renderHtmlToPdf(html, options);
      // Senior Optimization: Zero-Copy Transferable Object memory transfer
      const arrayBuffer = pdfBuffer.buffer.slice(
        pdfBuffer.byteOffset,
        pdfBuffer.byteOffset + pdfBuffer.byteLength
      );
      parentPort.postMessage(
        { id, success: true, result: arrayBuffer },
        [arrayBuffer]
      );
    } catch (err) {
      parentPort.postMessage({ id, success: false, error: err.message });
    }
  });
}
