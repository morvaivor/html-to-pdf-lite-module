import { Worker } from 'node:worker_threads';
import { cpus, availableParallelism } from 'node:os';
import type { WorkerPoolStats, WorkerTask, WorkerResponse, PdfGenerateOptions } from '../types.js';

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

export interface WorkerPoolOptions {
  cpuRatio?: number;
  maxWorkers?: number | null;
  idleTimeoutMs?: number;
}

/**
 * Dynamic On-Demand Elastic Worker Thread Pool.
 * Spawns workers dynamically on demand up to maxWorkers, and automatically
 * terminates idle workers after idleTimeoutMs to return memory to the OS.
 */
export class WorkerPool {
  readonly maxWorkers: number;
  private readonly idleTimeoutMs: number;
  private readonly workerScript: URL;
  private workers: Worker[] = [];
  private freeWorkers: Worker[] = [];
  private readonly idleTimers: Map<Worker, NodeJS.Timeout> = new Map();
  private readonly taskQueue: WorkerTask[] = [];
  private nextTaskId: number = 1;
  private readonly activeTasks: Map<number, WorkerTask> = new Map();
  private isTerminated: boolean = false;

  constructor(options: WorkerPoolOptions = {}) {
    const cpuRatio = options.cpuRatio ?? 0.5; // Moderate mode default 50% CPU
    this.maxWorkers = calculateMaxWorkers(cpuRatio, options.maxWorkers);
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10_000; // Auto-terminate idle workers after 10s
    this.workerScript = new URL('./pdfWorker.js', import.meta.url);
    // Note: 0 workers created at startup to keep baseline RAM at ~116 MB
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
    });

    this.workers.push(worker);
    return worker;
  }

  private setIdleTimer(worker: Worker): void {
    if (this.idleTimeoutMs <= 0) return;
    this.clearIdleTimer(worker);

    const timer = setTimeout(() => {
      if (this.freeWorkers.includes(worker) && this.taskQueue.length === 0) {
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
    };
  }

  async terminate(): Promise<void> {
    this.isTerminated = true;
    this.taskQueue.length = 0;
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
