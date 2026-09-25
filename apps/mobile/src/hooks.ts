import { useCallback, useEffect, useState } from 'react';
import { friendlyMessage } from './lib/api-client';
import { useSession } from './session';

/** GET helper with loading/error/refresh. GET routes never create state on the server. */
export function useQuery<T>(path: string | null) {
  const { api } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const refresh = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api.request<T>('GET', path));
      setError(null);
    } catch (e) {
      setError(friendlyMessage(e));
    } finally {
      setLoading(false);
    }
  }, [api, path]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { data, error, loading, refresh };
}
