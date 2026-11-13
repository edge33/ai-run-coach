// Temporary exploration entry point, separate from application sync and SQLite.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { localToday, validateRange } from '../packages/contracts/src/index.ts';
import { GarminClient, GarminError } from '../packages/core/src/garmin/client.ts';
import { exploreGarmin } from '../packages/core/src/garmin/explore.ts';

try {
  const { values } = parseArgs({ options: { start: { type: 'string' }, end: { type: 'string' } } });
  if (!values.start || !values.end) throw new GarminError('EXPLICIT_START_AND_END_REQUIRED');
  const range = validateRange({ start: values.start, end: values.end }, 31);
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: This standalone probe is never run or cached by Turbo.
  const timezone = process.env.ATHLETE_TIMEZONE ?? 'Europe/Rome';
  if (range.end > localToday(timezone)) {
    throw new GarminError('FUTURE_DATES_NOT_ALLOWED');
  }
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: This standalone probe is never run or cached by Turbo.
  const client = new GarminClient(process.env.GARMIN_API_KEY ?? '');
  const report = await exploreGarmin(client, range);
  const root = fileURLToPath(new URL('../data/garmin-probes/', import.meta.url));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(`${root}probe-`);
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`Private extraction saved to ${directory}/report.json`);
  console.log(
    `${report.activities.length} activities, ${report.runs.length} runs, ${report.wellness.length} wellness dates. No database changes.`,
  );
} catch (error) {
  // Never print upstream bodies, SDK errors, Zod input values, or credentials.
  const code = error instanceof GarminError ? error.message : 'PROBE_VALIDATION_OR_OUTPUT_FAILED';
  console.error(`Garmin exploration failed: ${code}. No database changes.`);
  process.exitCode = 1;
}
