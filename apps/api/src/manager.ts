import { EventEmitter } from 'node:events';
import type { SyncRequest } from '@hub/contracts';
import { beginSync, type Config, executeSync, logger } from '@hub/core';
import type { Store } from '@hub/db';

export class SyncManager {
  readonly events = new EventEmitter();
  private readonly store: Store;
  private readonly config: Config;
  private readonly shutdown = new AbortController();
  private task: Promise<void> | undefined;

  constructor(store: Store, config: Config) {
    this.store = store;
    this.config = config;
  }

  async start(request: SyncRequest) {
    if (this.shutdown.signal.aborted) throw new Error('API_CLOSING');

    if (!this.config.apiKey) throw new Error('CREDENTIALS_NOT_CONFIGURED');

    const run = await beginSync(this.store, request, this.config.timezone);
    this.task = this.execute(run.id).catch(() => {
      logger.error({ code: 'SYNC_CLEANUP_FAILED' }, 'Sync cleanup failed');
    });

    return run;
  }

  private async execute(id: string) {
    try {
      await executeSync(this.store, this.config, id, {
        signal: this.shutdown.signal,
        progress: (run) => this.events.emit(id, run),
      });
    } catch {
      logger.error({ code: 'SYNC_EXECUTION_FAILED' }, 'Sync failed');

      // Recover failures outside executeSync's normal finalization path.
      const run = await this.store.syncRun(id);

      if (run?.status === 'running') {
        await this.store.updateSync(id, {
          status: 'interrupted',
          error_code: 'WORKER_INTERRUPTED',
          completed_at: new Date().toISOString(),
        });

        await this.store.releaseLease(id);
        this.events.emit(id, await this.store.syncRun(id));
      }
    }
  }

  async close() {
    this.shutdown.abort();
    await this.task;

    this.events.removeAllListeners();
  }
}
