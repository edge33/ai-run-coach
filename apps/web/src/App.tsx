import {
  addDays,
  type DateRange,
  DEFAULT_SYNC_DAYS,
  localToday,
  MAX_SYNC_DAYS,
  validateRange,
} from '@hub/contracts';
import { useEffect, useState } from 'react';
import { useStatus, useSync } from './api.ts';
import { ErrorNotice } from './components.tsx';
import { Health } from './Health.tsx';
import { Runs } from './Runs.tsx';

export function App() {
  const status = useStatus();
  const sync = useSync();
  const today = status.data?.today ?? localToday('Europe/Rome');
  const [selectedRange, setSelectedRange] = useState<DateRange | null>(null);
  const range = selectedRange ?? { start: addDays(today, 1 - DEFAULT_SYNC_DAYS), end: today };
  let rangeError: string | null = null;
  try {
    validateRange(range, MAX_SYNC_DAYS);
    if (range.end > today) rangeError = 'Choose dates up to today.';
  } catch {
    rangeError = `Choose a valid start and end date covering 1–${MAX_SYNC_DAYS} days.`;
  }
  // Cached server status must not lock the form after another request ends or its writer crashes.
  const [clock, setClock] = useState(Date.now);
  const cooldownUntil = status.data?.cooldown_until;
  const cooldownActive = !!cooldownUntil && Date.parse(cooldownUntil) > clock;
  useEffect(() => {
    if (!cooldownUntil || Date.parse(cooldownUntil) <= clock) return;
    const remaining = Date.parse(cooldownUntil) - Date.now();
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.max(0, Math.min(remaining + 50, 60000)),
    );
    return () => clearTimeout(timer);
  }, [cooldownUntil, clock]);
  const busy = sync.pending;
  const lastImport = sync.data ?? status.data?.latest;
  const contractChanged = !busy && lastImport?.error_code === 'GARMIN_CONTRACT_CHANGED';

  return (
    <main>
      <header>
        <h1>Running data</h1>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!rangeError && !busy && !cooldownActive && !status.isPending && !status.isError) {
            sync.mutate({ mode: 'range', ...range });
          }
        }}
      >
        <fieldset disabled={busy}>
          <legend>Sync dates</legend>
          <label>
            Start date
            <input
              type="date"
              required
              value={range.start}
              max={range.end || today}
              onChange={(event) => setSelectedRange({ ...range, start: event.target.value })}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              required
              value={range.end}
              min={range.start}
              max={today}
              onChange={(event) => setSelectedRange({ ...range, end: event.target.value })}
            />
          </label>
          <button
            type="submit"
            disabled={busy || cooldownActive || status.isPending || status.isError || !!rangeError}
          >
            {busy ? 'Syncing…' : 'Sync'}
          </button>
        </fieldset>
      </form>
      <p>
        Import runs and health from Garmin Connect. Maximum 3 months (90 days), including both
        dates.
      </p>
      {rangeError ? <p role="alert">{rangeError}</p> : null}
      <ErrorNotice error={status.error} />
      <ErrorNotice error={sync.error} />
      {busy ? <p role="status">Syncing with Garmin Connect. Please wait…</p> : null}
      {sync.data && !sync.pending ? (
        <p role="status">
          Sync {sync.data.status}: {sync.data.upserted} records saved, {sync.data.rejected}{' '}
          unavailable.
        </p>
      ) : null}
      {cooldownActive || (!busy && lastImport?.error_code === 'HTTP_429') ? (
        <p role="alert">
          Garmin is rate limiting requests. No import data was saved.
          {cooldownActive
            ? ` Try again after ${new Date(cooldownUntil ?? '').toLocaleString()}.`
            : ' Garmin has not provided an active cooldown. Wait before trying again.'}
        </p>
      ) : null}
      {contractChanged ? (
        <p role="alert">
          Garmin returned an unexpected response format (GARMIN_CONTRACT_CHANGED). The import
          stopped and no data was saved. Existing data is unchanged.
        </p>
      ) : null}
      {status.data?.latest ? (
        <p>
          Latest sync: {status.data.latest.started_at.replace('T', ' ')} ·{' '}
          {status.data.latest.status}
        </p>
      ) : null}
      <p>All stored records, newest first. Up to 50 entries per page. — means not recorded.</p>
      <Runs />
      <Health />
    </main>
  );
}
