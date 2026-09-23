import type { DateRange } from '@hub/contracts';
import type { ReactNode } from 'react';

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        ↗
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function ErrorNotice({ error }: { error: Error | null }) {
  return error ? (
    <p className="notice error" role="alert">
      {error.message}
    </p>
  ) : null;
}
export function DateFilter({
  range,
  onChange,
}: {
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  return (
    <div className="date-filter">
      <label>
        From
        <input
          type="date"
          value={range.start}
          max={range.end}
          onChange={(event) => {
            if (event.target.value) onChange({ ...range, start: event.target.value });
          }}
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={range.end}
          min={range.start}
          onChange={(event) => {
            if (event.target.value) onChange({ ...range, end: event.target.value });
          }}
        />
      </label>
    </div>
  );
}
export function Pagination({
  total,
  offset,
  limit = 50,
  onChange,
}: {
  total: number;
  offset: number;
  limit?: number;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total ? `${offset + 1}–${Math.min(total, offset + limit)} of ${total}` : '0 records'}
      </span>
      <div>
        <button
          type="button"
          className="secondary"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <button
          type="button"
          className="secondary"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
