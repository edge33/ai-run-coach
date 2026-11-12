import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from './App.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test('the empty app explains unavailable data without requesting synchronization', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Running Data Hub' })).toBeTruthy();
  expect(screen.getByText('Running and wellness data are currently unavailable.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /sync/i })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
