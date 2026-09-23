import { syncRunSchema } from '@hub/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/** Subscribe only while a manual synchronization is active. */
export function useSyncProgress(activeId: string | undefined) {
  const client = useQueryClient();
  const [streamError, setStreamError] = useState(false);
  useEffect(() => {
    if (!activeId) return;
    const stream = new EventSource(`/api/sync-runs/${activeId}/events`);
    stream.addEventListener('open', () => setStreamError(false));
    stream.addEventListener('progress', (event) => {
      const parsed = syncRunSchema.safeParse(JSON.parse((event as MessageEvent).data));
      if (!parsed.success) return;
      client.setQueryData(['active-sync'], parsed.data);
      if (parsed.data.status !== 'running') {
        stream.close();
        void client.invalidateQueries();
      }
    });
    stream.onerror = () => setStreamError(true);
    return () => stream.close();
  }, [activeId, client]);
  return { streamError };
}
