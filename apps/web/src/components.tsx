import type { ReactNode } from 'react';

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
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
