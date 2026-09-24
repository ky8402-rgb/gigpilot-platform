import { EventEmitter } from 'events';

export interface Job<T = any> {
  id: string;
  name: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type JobProcessor<T = any, R = any> = (job: Job<T>) => Promise<R>;

export class SimpleJobQueue<T = any> extends EventEmitter {
  private queue: Job<T>[] = [];
  private processing: Map<string, Job<T>> = new Map();
  private completed: Job<T>[] = [];
  private failed: Job<T>[] = [];
  private processor: JobProcessor<T> | null = null;
  private isRunning = false;
  private concurrency: number;

  constructor(public readonly name: string, concurrency: number = 2) {
    super();
    this.concurrency = concurrency;
  }

  public async add(name: string, data: T, maxAttempts: number = 3): Promise<Job<T>> {
    const job: Job<T> = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      data,
      attempts: 0,
      maxAttempts,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.queue.push(job);
    this.emit('added', job);
    this.processNext();
    return job;
  }

  public process(processor: JobProcessor<T>) {
    this.processor = processor;
    this.isRunning = true;
    this.processNext();
  }

  private async processNext() {
    if (!this.isRunning || !this.processor) return;
    if (this.processing.size >= this.concurrency) return;
    if (this.queue.length === 0) return;

    const job = this.queue.shift();
    if (!job) return;

    job.status = 'processing';
    job.attempts++;
    job.updatedAt = Date.now();
    this.processing.set(job.id, job);
    this.emit('active', job);

    try {
      const result = await this.processor(job);
      job.status = 'completed';
      job.result = result;
      job.updatedAt = Date.now();
      this.processing.delete(job.id);
      this.completed.push(job);
      if (this.completed.length > 50) this.completed.shift();
      this.emit('completed', job, result);
    } catch (err: any) {
      job.error = err.message || String(err);
      job.updatedAt = Date.now();
      this.processing.delete(job.id);

      if (job.attempts < job.maxAttempts) {
        job.status = 'pending';
        // Exponential backoff before re-queueing
        const delay = Math.min(1000 * Math.pow(2, job.attempts), 10000);
        setTimeout(() => {
          this.queue.unshift(job);
          this.processNext();
        }, delay);
        this.emit('retry', job, err);
      } else {
        job.status = 'failed';
        this.failed.push(job);
        if (this.failed.length > 50) this.failed.shift();
        this.emit('failed', job, err);
      }
    }

    // Process additional available work
    this.processNext();
  }

  public getStats() {
    return {
      name: this.name,
      pending: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.length,
      failed: this.failed.length
    };
  }
}

// Global background job queues
export const proposalGenerationQueue = new SimpleJobQueue('proposal-generation', 3);
export const reportProcessingQueue = new SimpleJobQueue('report-processing', 2);
export const emailNotificationQueue = new SimpleJobQueue('email-notifications', 2);
