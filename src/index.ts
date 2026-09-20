export { PdfGenerator, createPdfGenerator, default } from './pdfGenerator.js';
export { WorkerPool, WorkerPoolBusyError, calculateMaxWorkers, type WorkerPoolOptions } from './workers/workerPool.js';
export { verifyRenderingQuality, type QualityAuditResult, type QualityCheckOptions } from './qualityAuditor.js';
export { Logger, createLogger, type LoggerOptions } from './core/logger.js';
export type {
  LogLevel,
  MarginOptions,
  RequiredMargin,
  WorkerPoolStats,
  PdfGeneratorConfig,
  PdfGenerateOptions,
  PaperFormat,
  Orientation,
  TextAlign,
  PageZoneName,
  PageZones,
  PageZoneProperties,
  TextStyle,
  CssRule,
  FontFace,
  WorkerTask,
  WorkerMessage,
  WorkerResponse,
  ProfilingTimings,
} from './types.js';
