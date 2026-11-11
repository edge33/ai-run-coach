import { MAX_RUN_SAMPLES, runSampleSchema } from '@hub/contracts';
import { z } from 'zod';

// Keep the API's distinct processed/raw power and original/corrected altitude streams.
export const runStreamTypes = [
  'time',
  'distance',
  'velocity_smooth',
  'heartrate',
  'watts',
  'raw_watts',
  'altitude',
  'fixed_altitude',
  'cadence',
] as const;

const valuesSchema = z.array(z.number().finite().nullable()).max(MAX_RUN_SAMPLES);

export function mapRunStreams(runId: string, source: unknown) {
  const streams = z
    .array(z.object({ type: z.string(), data: z.unknown(), allNull: z.boolean().optional() }))
    .max(100)
    .parse(source);
  const values = new Map<string, (number | null)[]>();
  for (const stream of streams) {
    if (!runStreamTypes.some((type) => type === stream.type)) continue;
    if (values.has(stream.type)) throw new Error('DUPLICATE_STREAM');
    values.set(
      stream.type,
      stream.allNull && stream.data == null ? [] : valuesSchema.parse(stream.data),
    );
  }
  if (!values.size) return [];
  const times = values.get('time');
  if (!times) throw new Error('TIME_STREAM_REQUIRED');
  for (const stream of streams) {
    const data = values.get(stream.type);
    if (!data) continue;
    if (stream.allNull && (stream.data == null || data.length === 0)) {
      values.set(stream.type, Array(times.length).fill(null));
    } else if (data.length !== times.length) throw new Error('STREAM_LENGTH_MISMATCH');
  }
  return times.map((elapsed, index) => {
    if (elapsed === null || elapsed < 0 || (index > 0 && elapsed < (times[index - 1] ?? 0)))
      throw new Error('INVALID_SAMPLE_TIME');
    const at = (type: string) => values.get(type)?.[index] ?? null;
    return runSampleSchema.parse({
      run_id: runId,
      sample_index: index,
      elapsed_s: elapsed,
      distance_m: at('distance'),
      speed_mps: at('velocity_smooth'),
      hr_bpm: at('heartrate'),
      power_w: at('watts'),
      raw_power_w: at('raw_watts'),
      altitude_m: at('altitude'),
      corrected_altitude_m: at('fixed_altitude'),
      cadence_rpm: at('cadence'),
    });
  });
}
