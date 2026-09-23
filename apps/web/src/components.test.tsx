import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { number, pace } from './api.ts';
import { Empty, ErrorNotice, Pagination } from './components.tsx';

afterEach(cleanup);
describe('sparse data and controls', () => {
  it('distinguishes null from recorded zero and formats pace without inventing values', () => {
    expect(number(null)).toBe('—');
    expect(number(0)).toBe('0');
    expect(pace(null)).toBe('—');
    expect(pace(359.8)).toBe('6:00');
  });
  it('renders explicit empty and error states', () => {
    render(
      <>
        <Empty title="No runs yet">Import when you are ready.</Empty>
        <ErrorNotice error={new Error('Import unavailable')} />
      </>,
    );
    expect(screen.getByText('No runs yet')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Import unavailable');
  });
  it('bounds pagination and only changes pages after a click', () => {
    const changed = vi.fn();
    render(<Pagination total={70} offset={0} onChange={changed} />);
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(changed).toHaveBeenCalledWith(50);
  });
});
