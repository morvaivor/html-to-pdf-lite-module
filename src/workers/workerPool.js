import { Worker } from 'node:worker_threads';
import { cpus, availableParallelism } from 'node:os';

/**
 * Calculates max worker count based on CPU core ratio (default 50% for moderate mode).
 */
export function calculateMaxWorkers(cpuRatio = 0.5, explicitMax = null) {
  if (typeof explicitMax === 'number' && explicitMax > 0) {
    return Math.max(1, Math.floor(explicitMax));
  }
  const totalCores = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  const ratio = Math.min(1.0, Math.max(0.1, cpuRatio));
  return Math.max(1, Math.floor(totalCores * ratio));
}

/**
 * Dynamic On-Demand Elastic Worker Thread Pool.
 * Spawns workers dynamically on demand up to maxWorkers, and automatically
 * terminates idle workers after idleTimeoutMs to return memory to the OS.
 */
export class WorkerPool {
  constructor(options = {}) {
    const cpuRatio = options.cpuRatio ?? 0.5; // Moderate mode default 50% CPU
    this.maxWorkers = calculateMaxWorkers(cpuRatio, options.maxWorkers);
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10000; // Auto-terminate idle workers after 10s
    this.workerScript = new URL('./pdfWorker.js', import.meta.url);
    this.workers = [];
    this.freeWorkers = [];
    this.idleTimers = new Map();
    this.taskQueue = [];
    this.nextTaskId = 1;
    this.activeTasks = new Map();
    this.isTerminated = false;
    // Note: 0 workers created at startup to keep baseline RAM at ~116 MB
  }

  createWorker() {
    const worker = new Worker(this.workerScript);

    worker.on('message', ({ id, success, result, error }) => {
      this.clearIdleTimer(worker);
      const task = this.activeTasks.get(id);
      if (task) {
        this.activeTasks.delete(id);
        if (success) {
          // Zero-Copy conversion from ArrayBuffer to Buffer
          task.resolve(Buffer.from(result));
        } else {
          task.reject(new Error(error));
        }
      }
      this.freeWorkers.push(worker);
      this.setIdleTimer(worker);
      this.processQueue();
    });

    worker.on('error', (err) => {
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

  setIdleTimer(worker) {
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

  clearIdleTimer(worker) {
    const timer = this.idleTimers.get(worker);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(worker);
    }
  }

  removeWorker(worker) {
    this.clearIdleTimer(worker);
    const idx = this.workers.indexOf(worker);
    if (idx !== -1) this.workers.splice(idx, 1);
    const freeIdx = this.freeWorkers.indexOf(worker);
    if (freeIdx !== -1) this.freeWorkers.splice(freeIdx, 1);
    worker.terminate();
  }

  processQueue() {
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
    task.worker = worker;
    this.activeTasks.set(task.id, task);

    worker.postMessage({
      id: task.id,
      html: task.html,
      options: task.options,
    });
  }

  runTask(html, options = {}) {
    if (this.isTerminated) {
      return Promise.reject(new Error('WorkerPool is terminated'));
    }

    return new Promise((resolve, reject) => {
      const id = this.nextTaskId++;
      this.taskQueue.push({ id, html, options, resolve, reject });
      this.processQueue();
    });
  }

  getStats() {
    return {
      totalWorkers: this.workers.length,
      freeWorkers: this.freeWorkers.length,
      activeTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length,
      maxWorkers: this.maxWorkers,
    };
  }

  async terminate() {
    this.isTerminated = true;
    this.taskQueue = [];
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    const terminations = this.workers.map(w => w.terminate());
    this.workers = [];
    this.freeWorkers = [];
    this.activeTasks.clear();
    await Promise.all(terminations);
  }
}
