import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node e2e/server.ts',
      url: 'http://127.0.0.1:3100/healthz',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev --workspace @hub/web -- --port 5175 --strictPort',
      url: 'http://127.0.0.1:5175',
      env: { API_TARGET: 'http://127.0.0.1:3100' },
      reuseExistingServer: false,
    },
  ],
});
