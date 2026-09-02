export interface MarginOptions {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface WorkerPoolStats {
  totalWorkers: number;
  freeWorkers: number;
  activeTasks: number;
  queuedTasks: number;
  maxWorkers: number;
}

export interface PdfGeneratorConfig {
  defaultFormat?: 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal' | string;
  defaultOrientation?: 'portrait' | 'landscape';
  defaultMargin?: MarginOptions;
  css?: string;
  header?: string;
  footer?: string;
  /** Enable Worker Thread Pool for CPU offloading */
  useWorkerPool?: boolean;
  /** Max CPU cores ratio limit (e.g. 0.5 for moderate 50% CPU, default 0.5) */
  cpuRatio?: number;
  /** Explicit max worker count override */
  maxWorkers?: number;
  /** Auto-terminate idle workers after idleTimeoutMs (default 10000 ms) */
  idleTimeoutMs?: number;
}

export interface PdfGenerateOptions {
  format?: string;
  orientation?: 'portrait' | 'landscape';
  margin?: MarginOptions;
  css?: string;
  header?: string;
  footer?: string;
}

export class PdfGenerator {
  constructor(config?: PdfGeneratorConfig);
  generate(html: string, options?: PdfGenerateOptions): Promise<Buffer>;
  getMaxWorkers(): number;
  getWorkerStats(): WorkerPoolStats;
  terminateWorkerPool(): Promise<void>;
}

export function createPdfGenerator(config?: PdfGeneratorConfig): PdfGenerator;
