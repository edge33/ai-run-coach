import { Decoder, Stream } from '@garmin/fitsdk';
import { Unzip, UnzipInflate } from 'fflate';
import { z } from 'zod';
import { GarminError } from './client.ts';

const MAX_FIT_BYTES = 16 * 1024 * 1024;
const MAX_SAMPLES = 200000;
const number = z.number().finite().nullable();
const positive = number.refine((value) => value === null || value >= 0);
const row = z.record(z.string(), z.unknown());

function measurement(value: unknown, altitude = false) {
  return (altitude ? number : positive).parse(value ?? null);
}

function seconds(value: unknown) {
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new GarminError('INVALID_FIT_TIMESTAMP');
  }
  return value.valueOf() / 1000;
}

// Extract to bounded memory only. Never write ZIP member names to the filesystem.
function unwrapFit(bytes: Uint8Array) {
  if (bytes.length > MAX_FIT_BYTES) throw new GarminError('FILE_TOO_LARGE');
  if (Decoder.isFIT(Stream.fromByteArray(bytes))) return bytes;
  let members = 0;
  let size = 0;
  const fits: Uint8Array[] = [];
  const unzip = new Unzip((file) => {
    members++;
    if (members > 10) throw new GarminError('TOO_MANY_ARCHIVE_MEMBERS');
    if (!file.name.toLowerCase().endsWith('.fit')) return;
    if ((file.originalSize ?? 0) > MAX_FIT_BYTES) throw new GarminError('FILE_TOO_LARGE');
    const chunks: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      if (error) throw new GarminError('INVALID_ARCHIVE');
      size += chunk.length;
      if (size > MAX_FIT_BYTES) {
        file.terminate();
        throw new GarminError('FILE_TOO_LARGE');
      }
      chunks.push(chunk);
      if (final) fits.push(Buffer.concat(chunks));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    // Chunking also bounds temporary decompression buffers for misleading ZIP size headers.
    for (let offset = 0; offset < bytes.length; offset += 1024) {
      unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
    }
  } catch (error) {
    if (error instanceof GarminError) throw error;
    throw new GarminError('INVALID_ARCHIVE');
  }
  if (fits.length !== 1) throw new GarminError('EXPECTED_ONE_FIT_FILE');
  return fits[0];
}

function metrics(source: Record<string, unknown>) {
  return {
    distance_m: measurement(source.totalDistance),
    duration_s: measurement(source.totalElapsedTime),
    timer_time_s: measurement(source.totalTimerTime),
    avg_speed_mps: measurement(source.enhancedAvgSpeed ?? source.avgSpeed),
    max_speed_mps: measurement(source.enhancedMaxSpeed ?? source.maxSpeed),
    avg_hr_bpm: measurement(source.avgHeartRate),
    max_hr_bpm: measurement(source.maxHeartRate),
    avg_power_w: measurement(source.avgPower),
    max_power_w: measurement(source.maxPower),
    moving_time_s: measurement(source.totalMovingTime),
    elevation_gain_m: measurement(source.totalAscent),
    elevation_loss_m: measurement(source.totalDescent),
    // Keep the source components so the steps/minute conversion remains auditable.
    avg_cadence_cycles_per_min: measurement(source.avgCadence),
    avg_fractional_cadence: measurement(source.avgFractionalCadence),
    avg_cadence_spm: cadenceSpm(source.avgCadence, source.avgFractionalCadence),
  };
}

function cadenceSpm(cadence: unknown, fractional: unknown) {
  const cycles = measurement(cadence);
  const fraction = measurement(fractional);
  return cycles === null ? null : 2 * (cycles + (fraction ?? 0));
}

export function segmentTiming(
  startTime: number | null,
  endTime: number | null,
  elapsed: number | null,
  lap = false,
) {
  if (startTime !== null && (!Number.isFinite(startTime) || startTime < 0))
    throw new GarminError('INVALID_SEGMENT_START');
  if (endTime !== null && (!Number.isFinite(endTime) || endTime < 0))
    throw new GarminError('INVALID_SEGMENT_END');
  let warning:
    | 'INVALID_SOURCE_BOUNDARY'
    | 'LAP_TIMESTAMP_NOT_END'
    | 'DURATION_TIMESTAMP_MISMATCH'
    | null = null;
  if (endTime !== null && startTime !== null) {
    if (endTime < startTime || (endTime === startTime && elapsed !== null && elapsed > 0)) {
      warning = lap ? 'LAP_TIMESTAMP_NOT_END' : 'INVALID_SOURCE_BOUNDARY';
      endTime = null;
    } else if (elapsed !== null && Math.abs(endTime - startTime - elapsed) > 2) {
      // FIT boundaries can be rounded to whole seconds. Flag larger differences; never reconcile them.
      warning = 'DURATION_TIMESTAMP_MISMATCH';
    }
  }
  return { start_time_s: startTime, end_time_s: endTime, timing_warning: warning };
}

function normalizeLap(lap: Record<string, unknown>, sequence: number, start: number) {
  const startTime = lap.startTime == null ? null : seconds(lap.startTime) - start;
  const messageTime = lap.timestamp == null ? null : seconds(lap.timestamp) - start;
  const elapsed = measurement(lap.totalElapsedTime);
  // Real files can repeat the activity start as every lap's message timestamp.
  // Retain that evidence, but do not label an impossible timestamp as the lap's end.
  return {
    sequence,
    ...segmentTiming(startTime, messageTime, elapsed, true),
    message_time_s: messageTime,
    intensity: z.string().nullish().parse(lap.intensity) ?? null,
    trigger: z.string().nullish().parse(lap.lapTrigger) ?? null,
    workout_step_index: z.number().int().nonnegative().nullish().parse(lap.wktStepIndex) ?? null,
    ...metrics(lap),
  };
}

export function decodeActivityFile(bytes: Uint8Array) {
  try {
    const fit = unwrapFit(bytes);
    const decoder = new Decoder(Stream.fromByteArray(fit));
    if (!decoder.checkIntegrity()) throw new GarminError('INVALID_FIT_INTEGRITY');
    const { messages, errors } = decoder.read({
      applyScaleAndOffset: true,
      expandSubFields: true,
      expandComponents: true,
      convertDateTimesToDates: true,
      convertTypesToStrings: true,
      mergeHeartRates: false,
      includeUnknownData: false,
    });
    if (errors.length) throw new GarminError('FIT_DECODE_FAILED');
    const sessions = z.array(row).length(1).parse(messages.sessionMesgs);
    const session = sessions[0];
    const start = seconds(session.startTime);
    const records = z
      .array(row)
      .max(MAX_SAMPLES)
      .parse(messages.recordMesgs ?? []);
    let previous = 0;
    const samples = records.map((record, sample_index) => {
      const elapsed_s = seconds(record.timestamp) - start;
      if (elapsed_s < previous) throw new GarminError('BACKWARDS_FIT_TIME');
      previous = elapsed_s;
      return {
        sample_index,
        elapsed_s,
        distance_m: measurement(record.distance),
        speed_mps: measurement(record.enhancedSpeed ?? record.speed),
        hr_bpm: measurement(record.heartRate),
        power_w: measurement(record.power),
        altitude_m: measurement(record.enhancedAltitude ?? record.altitude, true),
        cadence_cycles_per_min: measurement(record.cadence),
        fractional_cadence: measurement(record.fractionalCadence),
        cadence_spm: cadenceSpm(record.cadence, record.fractionalCadence),
      };
    });
    const laps = z
      .array(row)
      .max(10000)
      .parse(messages.lapMesgs ?? [])
      .map((lap, sequence) => normalizeLap(lap, sequence, start));
    const splits = z
      .array(row)
      .max(10000)
      .parse(messages.splitMesgs ?? [])
      .map((split, sequence) => ({
        sequence,
        split_type: z.string().nullish().parse(split.splitType) ?? null,
        ...segmentTiming(
          split.startTime == null ? null : seconds(split.startTime) - start,
          split.endTime == null ? null : seconds(split.endTime) - start,
          measurement(split.totalElapsedTime),
        ),
        first_lap_index:
          z.number().int().nonnegative().nullish().parse(split.firstLapIndex) ?? null,
        number_of_laps: z.number().int().nonnegative().nullish().parse(split.numLaps) ?? null,
        ...metrics(split),
      }));
    const timerEvents = z
      .array(row)
      .max(10000)
      .parse(messages.eventMesgs ?? [])
      .filter((event) => event.event === 'timer')
      .map((event) => ({
        elapsed_s: seconds(event.timestamp) - start,
        event_type: z.string().parse(event.eventType),
      }));
    return {
      start_time_utc: new Date(start * 1000).toISOString(),
      sport: z.string().parse(session.sport),
      session: metrics(session),
      laps,
      splits,
      timer_events: timerEvents,
      samples,
      message_counts: Object.fromEntries(
        Object.entries(messages).map(([name, values]) => [name, values.length]),
      ),
    };
  } catch (error) {
    if (error instanceof GarminError) throw error;
    throw new GarminError('INVALID_FIT_DATA');
  }
}
