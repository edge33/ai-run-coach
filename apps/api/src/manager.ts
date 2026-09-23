import { type ChildProcess, fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { type SyncRequest, syncRunSchema } from '@hub/contracts';
import { beginSync, type Config, logger } from '@hub/core';
import type { Store } from '@hub/db';

export class SyncManager {
  readonly events = new EventEmitter();
  readonly children = new Map<string, ChildProcess>();
  readonly store: Store;
  readonly config: Config;
  constructor(store: Store, config: Config) {
    this.store = store;
    this.config = config;
  }
  async start(request: SyncRequest) {
    if (!this.config.apiKey) throw new Error('CREDENTIALS_NOT_CONFIGURED');
    const run = await beginSync(this.store, request, this.config.timezone);
    try {
      const worker = fork(fileURLToPath(new URL('./worker.ts', import.meta.url)), [run.id], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        execArgv: [],
        env: {
          ...process.env,
          SQLITE_PATH: this.config.databasePath,
          SNAPSHOT_PATH: this.config.snapshotPath,
          ATHLETE_TIMEZONE: this.config.timezone,
          INTERVALS_API_KEY: this.config.apiKey,
          INTERVALS_ATHLETE_ID: this.config.athleteId,
        },
      });
      this.children.set(run.id, worker);
      worker.on('message', (message) => {
        const parsed = syncRunSchema.safeParse(message);
        if (parsed.success) this.events.emit(run.id, parsed.data);
      });
      worker.once('error', () => {
        logger.error({ code: 'WORKER_START_FAILED' }, 'Sync worker failed');
      });
      worker.once('exit', () => {
        this.children.delete(run.id);
        void this.finishWorker(run.id).catch(() =>
          logger.error({ code: 'WORKER_CLEANUP_FAILED' }, 'Sync worker cleanup failed'),
        );
      });
      return run;
    } catch (error) {
      await this.finishWorker(run.id);
      throw error;
    }
  }
  async finishWorker(id: string) {
    const run = await this.store.syncRun(id);
    if (run?.status === 'running')
      await this.store.updateSync(id, {
        status: 'interrupted',
        error_code: 'WORKER_INTERRUPTED',
        completed_at: new Date().toISOString(),
      });
    await this.store.releaseLease(id);
    this.events.emit(id, await this.store.syncRun(id));
  }
  async close() {
    await Promise.all(
      [...this.children.entries()].map(
        ([id, child]) =>
          new Promise<void>((resolve) => {
            child.once('exit', () => {
              void this.finishWorker(id).finally(resolve);
            });
            child.kill('SIGTERM');
            const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
            timeout.unref();
            child.once('exit', () => clearTimeout(timeout));
          }),
      ),
    );
    this.events.removeAllListeners();
  }
}
