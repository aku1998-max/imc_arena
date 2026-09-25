import { jobs, type Deps } from '@imc/domain';

export interface WorkerOptions {
  pollMs: number;
  scheduleEveryMs: number;
  batchSize: number;
}

/**
 * Worker loop: periodically enqueue scheduled jobs (deduplicated per window) and drain due jobs.
 * Jobs are claimed with short transactions and leases, so several workers can run safely and a
 * crashed worker's jobs are reclaimed after their lease expires.
 */
export class Worker {
  private stopping = false;
  private lastSchedule = 0;
  private sleepTimer: NodeJS.Timeout | undefined;
  private wake: (() => void) | undefined;

  constructor(
    private readonly deps: Deps,
    private readonly opts: WorkerOptions,
  ) {}

  async tick(now = Date.now()): Promise<number> {
    if (now - this.lastSchedule >= this.opts.scheduleEveryMs) {
      await jobs.schedulePeriodicJobs(this.deps, new Date(now));
      this.lastSchedule = now;
    }
    const result = await jobs.runJobsOnce(this.deps, { limit: this.opts.batchSize });
    if (result.claimed > 0) {
      this.deps.log.info({ ...result }, 'jobs processed');
    }
    return result.claimed;
  }

  async run(): Promise<void> {
    while (!this.stopping) {
      let claimed = 0;
      try {
        claimed = await this.tick();
      } catch (err) {
        this.deps.log.error({ err: (err as Error).message }, 'worker tick failed');
      }
      // Drain quickly while there is work; otherwise poll.
      if (claimed === 0 && !this.stopping) await this.sleep(this.opts.pollMs);
    }
  }

  stop() {
    this.stopping = true;
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.wake?.();
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      this.wake = resolve;
      this.sleepTimer = setTimeout(resolve, ms);
    });
  }
}
