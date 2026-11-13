// Probe every component locally without importing data or requiring Garmin credentials.
try {
  await Promise.all(
    [
      'http://127.0.0.1:8080/',
      'http://127.0.0.1:3000/healthz',
      'http://127.0.0.1:3001/healthz',
    ].map(async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      await response.body?.cancel();
      if (!response.ok) throw new Error('UNHEALTHY');
    }),
  );
} catch {
  process.exitCode = 1;
}

export {};
