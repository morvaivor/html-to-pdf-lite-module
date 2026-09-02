import { renderHtmlToPdf } from './htmlRenderer.js';
import { WorkerPool, calculateMaxWorkers } from './workers/workerPool.js';

const DEFAULT_FORMAT = 'A4';
const DEFAULT_ORIENTATION = 'portrait';
const DEFAULT_MARGIN = {
  top: 20,
  bottom: 20,
  left: 20,
  right: 20,
};

export class PdfGenerator {
  constructor(config = {}) {
    this.config = {
      defaultFormat: config.defaultFormat ?? DEFAULT_FORMAT,
      defaultOrientation: config.defaultOrientation ?? DEFAULT_ORIENTATION,
      defaultMargin: config.defaultMargin ?? DEFAULT_MARGIN,
      css: config.css ?? '',
      header: config.header ?? '',
      footer: config.footer ?? '',
      useWorkerPool: config.useWorkerPool ?? false,
      cpuRatio: config.cpuRatio ?? 0.5, // Moderate Mode default 50% CPU
      maxWorkers: config.maxWorkers ?? null,
      idleTimeoutMs: config.idleTimeoutMs ?? 10000, // 10s idle auto-shutdown
    };

    this.workerPool = null;
    if (this.config.useWorkerPool) {
      this.workerPool = new WorkerPool({
        cpuRatio: this.config.cpuRatio,
        maxWorkers: this.config.maxWorkers,
        idleTimeoutMs: this.config.idleTimeoutMs,
      });
    }
  }

  /**
   * Returns maximum allowed worker count.
   */
  getMaxWorkers() {
    return calculateMaxWorkers(this.config.cpuRatio, this.config.maxWorkers);
  }

  /**
   * Returns current statistics of the Worker Thread Pool.
   */
  getWorkerStats() {
    if (!this.workerPool) {
      return { totalWorkers: 0, freeWorkers: 0, activeTasks: 0, queuedTasks: 0, maxWorkers: 0 };
    }
    return this.workerPool.getStats();
  }

  async generate(html, options = {}) {
    const mergedOptions = {
      format: options.format ?? this.config.defaultFormat,
      orientation: options.orientation ?? this.config.defaultOrientation,
      margin: {
        ...DEFAULT_MARGIN,
        ...this.config.defaultMargin,
        ...options.margin,
      },
      css: options.css ?? this.config.css,
      header: options.header ?? this.config.header,
      footer: options.footer ?? this.config.footer,
    };

    if (this.workerPool) {
      return this.workerPool.runTask(html, mergedOptions);
    }

    return renderHtmlToPdf(html, mergedOptions);
  }

  async terminateWorkerPool() {
    if (this.workerPool) {
      await this.workerPool.terminate();
      this.workerPool = null;
    }
  }
}

export function createPdfGenerator(config = {}) {
  return new PdfGenerator(config);
}

export default PdfGenerator;
