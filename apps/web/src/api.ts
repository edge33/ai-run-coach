import { statusSchema } from '@hub/contracts';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';

export async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      data.error === 'CREDENTIALS_NOT_CONFIGURED'
        ? 'Add your Intervals API key to the server configuration before syncing.'
        : data.error === 'SYNC_BUSY'
          ? 'A synchronization is already running.'
          : `Request failed (${response.status}). ${data.error ?? 'Try again.'}`,
    );
  }
  return schema.parse(await response.json());
}
export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: () => api('/status', statusSchema) });
}
export function queryString(values: Record<string, string | number>) {
  return new URLSearchParams(Object.entries(values).map(([k, v]) => [k, String(v)])).toString();
}
export function number(value: number | null | undefined, decimals = 0) {
  return value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}
export function pace(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
