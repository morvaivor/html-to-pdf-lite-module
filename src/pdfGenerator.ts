import { renderHtmlToPdf } from './htmlRenderer.js';
import { WorkerPool, calculateMaxWorkers } from './workers/workerPool.js';
import { verifyRenderingQuality, type QualityAuditResult, type QualityCheckOptions } from './qualityAuditor.js';
import type {
  PdfGeneratorConfig,
  PdfGenerateOptions,
  WorkerPoolStats,
  RequiredMargin,
  Orientation,
  PaperFormat,
  LogLevel,
  ProfilingTimings,
  GpuMode,
  GpuStats,
} from './types.js';
import { gpuAccelerator } from './gpu/gpuAccelerator.js';

const DEFAULT_FORMAT: PaperFormat = 'A4';
const DEFAULT_ORIENTATION: Orientation = 'portrait';
const DEFAULT_MARGIN: RequiredMargin = {
  top: 20,
  bottom: 20,
  left: 20,
  right: 20,
} as const;

interface ResolvedConfig {
  readonly defaultFormat: string;
  readonly defaultOrientation: Orientation;
  readonly defaultMargin: RequiredMargin;
  readonly css: string;
  readonly header: string;
  readonly footer: string;
  readonly useWorkerPool: boolean;
  readonly cpuRatio: number;
  readonly maxWorkers: number | null;
  readonly minWorkers: number;
  readonly maxQueueSize?: number;
  readonly idleTimeoutMs: number;
  readonly allowedLocalIps?: readonly string[];
  readonly allowedCssIps?: readonly string[];
  readonly verbose?: boolean | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  readonly logLevel?: LogLevel;
  readonly logFile?: string;
  readonly strictCss?: boolean;
  readonly debug?: boolean;
  readonly profiling?: boolean;
  readonly onProfile?: (timings: ProfilingTimings) => void;
  readonly gpu?: GpuMode;
}

export class PdfGenerator {
  private readonly config: ResolvedConfig;
  private workerPool: WorkerPool | null = null;

  constructor(config: PdfGeneratorConfig = {}) {
    this.config = {
      defaultFormat: config.defaultFormat ?? DEFAULT_FORMAT,
      defaultOrientation: config.defaultOrientation ?? DEFAULT_ORIENTATION,
      defaultMargin: config.defaultMargin ? { ...DEFAULT_MARGIN, ...config.defaultMargin } : DEFAULT_MARGIN,
      css: config.css ?? '',
      header: config.header ?? '',
      footer: config.footer ?? '',
      useWorkerPool: config.useWorkerPool ?? false,
      cpuRatio: config.cpuRatio ?? 0.5,
      maxWorkers: config.maxWorkers ?? null,
      minWorkers: config.minWorkers ?? 0,
      maxQueueSize: config.maxQueueSize,
      idleTimeoutMs: config.idleTimeoutMs ?? 10_000,
      allowedLocalIps: config.allowedLocalIps,
      allowedCssIps: config.allowedCssIps,
      verbose: config.verbose,
      logLevel: config.logLevel,
      logFile: config.logFile,
      strictCss: config.strictCss,
      debug: config.debug,
      profiling: config.profiling,
      onProfile: config.onProfile,
      gpu: config.gpu ?? 'auto',
    };

    if (this.config.useWorkerPool) {
      this.workerPool = new WorkerPool({
        cpuRatio: this.config.cpuRatio,
        maxWorkers: this.config.maxWorkers,
        minWorkers: this.config.minWorkers,
        maxQueueSize: this.config.maxQueueSize,
        idleTimeoutMs: this.config.idleTimeoutMs,
      });
    }
  }

  /**
   * Returns maximum allowed worker count.
   */
  getMaxWorkers(): number {
    return calculateMaxWorkers(this.config.cpuRatio, this.config.maxWorkers);
  }

  /**
   * Returns current statistics of the Worker Thread Pool.
   */
  getWorkerStats(): WorkerPoolStats {
    if (!this.workerPool) {
      return { totalWorkers: 0, freeWorkers: 0, activeTasks: 0, queuedTasks: 0, maxWorkers: 0 };
    }
    return this.workerPool.getStats();
  }

  /**
   * Returns current telemetry and statistics of the WebGPU acceleration engine.
   */
  getGpuStats(): GpuStats {
    if (this.workerPool) {
      return this.workerPool.getGpuStats();
    }
    return gpuAccelerator.getStats();
  }

  async generate(html: string, options: PdfGenerateOptions = {}): Promise<Buffer> {
    const mergedOptions: PdfGenerateOptions = {
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
      allowedLocalIps: options.allowedLocalIps ?? this.config.allowedLocalIps,
      allowedCssIps: options.allowedCssIps ?? this.config.allowedCssIps,
      verbose: options.verbose ?? this.config.verbose,
      logLevel: options.logLevel ?? this.config.logLevel,
      logFile: options.logFile ?? this.config.logFile,
      strictCss: options.strictCss ?? this.config.strictCss,
      debug: options.debug ?? this.config.debug,
      profiling: options.profiling ?? this.config.profiling,
      onProfile: options.onProfile ?? this.config.onProfile,
      gpu: options.gpu ?? this.config.gpu,
    };

    if (this.workerPool) {
      return this.workerPool.runTask(html, mergedOptions);
    }

    return renderHtmlToPdf(html, mergedOptions);
  }

  /**
   * Audits the rendering quality and fidelity of a generated PDF against the input HTML.
   */
  async auditQuality(html: string, options?: QualityCheckOptions): Promise<QualityAuditResult> {
    const pdfBuffer = await this.generate(html, options?.options);
    return verifyRenderingQuality(html, pdfBuffer, options);
  }

  async terminateWorkerPool(): Promise<void> {
    if (this.workerPool) {
      await this.workerPool.terminate();
      this.workerPool = null;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.terminateWorkerPool();
  }
}

export function createPdfGenerator(config: PdfGeneratorConfig = {}): PdfGenerator {
  return new PdfGenerator(config);
}

export default PdfGenerator;
