import { Worker } from 'node:worker_threads';
import { cpus, availableParallelism } from 'node:os';
import fs from 'node:fs';
import type { WorkerPoolStats, WorkerTask, WorkerResponse, PdfGenerateOptions, GpuStats } from '../types.js';

function resolveDefaultWorkerScript(): URL {
  try {
    const candidate1 = new URL('./pdfWorker.js', import.meta.url);
    if (fs.existsSync(candidate1)) return candidate1;
  } catch {}
  try {
    const candidate2 = new URL('./workers/pdfWorker.js', import.meta.url);
    if (fs.existsSync(candidate2)) return candidate2;
  } catch {}
  return new URL('./pdfWorker.js', import.meta.url);
}

/**
 * Calculates max worker count based on CPU core ratio (default 50% for moderate mode).
 */
export function calculateMaxWorkers(cpuRatio: number = 0.5, explicitMax: number | null = null): number {
  if (typeof explicitMax === 'number' && explicitMax > 0) {
    return Math.max(1, Math.floor(explicitMax));
  }
  const totalCores = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  const ratio = Math.min(1.0, Math.max(0.1, cpuRatio));
  return Math.max(1, Math.floor(totalCores * ratio));
}

export class WorkerPoolBusyError extends Error {
  constructor(message: string = 'Worker pool task queue is full') {
    super(message);
    this.name = 'WorkerPoolBusyError';
  }
}

export interface WorkerPoolOptions {
  cpuRatio?: number;
  maxWorkers?: number | null;
  minWorkers?: number;
  maxQueueSize?: number;
  idleTimeoutMs?: number;
  workerScript?: URL;
}

interface MutableGpuStats {
  available: boolean;
  adapterName: string | null;
  tablesProcessedGpu: number;
  tablesProcessedCpu: number;
  gpuKernelTimeMs: number;
  gpuUploadTimeMs: number;
  gpuReadbackTimeMs: number;
  fallbacks: number;
}

/**
 * Dynamic On-Demand Elastic Worker Thread Pool.
 * Spawns workers dynamically on demand up to maxWorkers, and automatically
 * terminates idle workers after idleTimeoutMs to return memory to the OS,
 * while maintaining a configurable warm-worker floor (minWorkers).
 */
export class WorkerPool {
  readonly maxWorkers: number;
  readonly minWorkers: number;
  readonly maxQueueSize: number;
  private readonly idleTimeoutMs: number;
  private readonly workerScript: URL;
  private workers: Worker[] = [];
  private freeWorkers: Worker[] = [];
  private readonly idleTimers: Map<Worker, NodeJS.Timeout> = new Map();
  private readonly taskQueue: WorkerTask[] = [];
  private nextTaskId: number = 1;
  private readonly activeTasks: Map<number, WorkerTask> = new Map();
  private isTerminated: boolean = false;
  private readonly poolGpuStats: MutableGpuStats = {
    available: false,
    adapterName: null,
    tablesProcessedGpu: 0,
    tablesProcessedCpu: 0,
    gpuKernelTimeMs: 0,
    gpuUploadTimeMs: 0,
    gpuReadbackTimeMs: 0,
    fallbacks: 0,
  };

  constructor(options: WorkerPoolOptions = {}) {
    const cpuRatio = options.cpuRatio ?? 0.5; // Moderate mode default 50% CPU
    this.maxWorkers = calculateMaxWorkers(cpuRatio, options.maxWorkers);
    this.minWorkers = Math.min(this.maxWorkers, Math.max(0, options.minWorkers ?? 0));
    this.maxQueueSize = options.maxQueueSize !== undefined ? options.maxQueueSize : this.maxWorkers * 2;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10_000; // Auto-terminate idle workers after 10s
    this.workerScript = options.workerScript ?? resolveDefaultWorkerScript();

    // Pre-spawn warm workers up to minWorkers floor
    for (let i = 0; i < this.minWorkers; i++) {
      const worker = this.createWorker();
      this.freeWorkers.push(worker);
      this.setIdleTimer(worker);
    }
  }

  private createWorker(): Worker {
    const worker = new Worker(this.workerScript);

    worker.on('message', (response: WorkerResponse) => {
      this.clearIdleTimer(worker);
      const { id, success } = response;
      const task = this.activeTasks.get(id);
      if (task) {
        this.activeTasks.delete(id);
        if (success && 'result' in response) {
          if (response.gpuStats) {
            const gs = response.gpuStats;
            this.poolGpuStats.available = this.poolGpuStats.available || gs.available;
            if (gs.adapterName) this.poolGpuStats.adapterName = gs.adapterName;
            this.poolGpuStats.tablesProcessedGpu += gs.tablesProcessedGpu;
            this.poolGpuStats.tablesProcessedCpu += gs.tablesProcessedCpu;
            this.poolGpuStats.gpuKernelTimeMs += gs.gpuKernelTimeMs;
            this.poolGpuStats.gpuUploadTimeMs += gs.gpuUploadTimeMs;
            this.poolGpuStats.gpuReadbackTimeMs += gs.gpuReadbackTimeMs;
            this.poolGpuStats.fallbacks += gs.fallbacks;
          }
          if (response.profilingTimings && task.options.onProfile) {
            try {
              task.options.onProfile(response.profilingTimings);
            } catch {
              // Ignore profiling callback error
            }
          }
          // Zero-Copy conversion from ArrayBuffer to Buffer
          task.resolve(Buffer.from(response.result));
        } else if (!success && 'error' in response) {
          task.reject(new Error(response.error));
        }
      }
      this.freeWorkers.push(worker);
      this.setIdleTimer(worker);
      this.processQueue();
    });

    worker.on('error', (err: Error) => {
      this.clearIdleTimer(worker);
      for (const [id, task] of this.activeTasks.entries()) {
        if (task.worker === worker) {
          this.activeTasks.delete(id);
          task.reject(err);
        }
      }
      this.removeWorker(worker);
      if (!this.isTerminated && this.workers.length < this.minWorkers) {
        const replacement = this.createWorker();
        this.freeWorkers.push(replacement);
        this.setIdleTimer(replacement);
      }
    });

    this.workers.push(worker);
    return worker;
  }

  private setIdleTimer(worker: Worker): void {
    if (this.idleTimeoutMs <= 0) return;
    this.clearIdleTimer(worker);

    const timer = setTimeout(() => {
      // Retain warm-worker floor: only terminate if worker count exceeds minWorkers
      if (this.freeWorkers.includes(worker) && this.taskQueue.length === 0 && this.workers.length > this.minWorkers) {
        this.removeWorker(worker);
      }
    }, this.idleTimeoutMs);

    if (timer.unref) timer.unref();
    this.idleTimers.set(worker, timer);
  }

  private clearIdleTimer(worker: Worker): void {
    const timer = this.idleTimers.get(worker);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(worker);
    }
  }

  private removeWorker(worker: Worker): void {
    this.clearIdleTimer(worker);
    const idx = this.workers.indexOf(worker);
    if (idx !== -1) this.workers.splice(idx, 1);
    const freeIdx = this.freeWorkers.indexOf(worker);
    if (freeIdx !== -1) this.freeWorkers.splice(freeIdx, 1);
    worker.terminate();
  }

  private processQueue(): void {
    if (this.isTerminated || this.taskQueue.length === 0) {
      return;
    }

    let worker = this.freeWorkers.shift();
    if (!worker && this.workers.length < this.maxWorkers) {
      worker = this.createWorker();
    }

    if (!worker) return;

    this.clearIdleTimer(worker);
    const task = this.taskQueue.shift();
    if (!task) return;

    task.worker = worker;
    this.activeTasks.set(task.id, task);

    worker.postMessage({
      id: task.id,
      html: task.html,
      options: task.options,
    });
  }

  runTask(html: string, options: PdfGenerateOptions = {}): Promise<Buffer> {
    if (this.isTerminated) {
      return Promise.reject(new Error('WorkerPool is terminated'));
    }

    if (this.maxQueueSize > 0 && this.taskQueue.length >= this.maxQueueSize) {
      return Promise.reject(
        new WorkerPoolBusyError(`Worker pool task queue is full (${this.taskQueue.length}/${this.maxQueueSize})`),
      );
    }

    return new Promise<Buffer>((resolve, reject) => {
      const id = this.nextTaskId++;
      this.taskQueue.push({ id, html, options, resolve, reject });
      this.processQueue();
    });
  }

  getStats(): WorkerPoolStats {
    return {
      totalWorkers: this.workers.length,
      freeWorkers: this.freeWorkers.length,
      activeTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length,
      maxWorkers: this.maxWorkers,
      minWorkers: this.minWorkers,
      maxQueueSize: this.maxQueueSize,
    };
  }

  getGpuStats(): GpuStats {
    return { ...this.poolGpuStats };
  }

  async terminate(): Promise<void> {
    this.isTerminated = true;
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      task?.reject(new Error('WorkerPool is terminated'));
    }
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    const terminations = this.workers.map((w) => w.terminate());
    this.workers = [];
    this.freeWorkers = [];
    this.activeTasks.clear();
    await Promise.all(terminations);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.terminate();
  }
}
