import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export interface UseApiOptions {
  skip?: boolean;
}

/**
 * Generic React hook for fetching from `/api/${path}`.
 *
 * Returns the parsed JSON payload along with loading and error states.
 * Never exposes secrets — the backend proxies all Kubernetes access.
 *
 * The path must begin with `/` and is joined as `/api${path}`.
 */
export default function useApi<T = unknown>(
  path: string,
  options: UseApiOptions = {},
): UseApiResult<T> {
  const { skip = false } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!skip);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (skip) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const normalized = path.startsWith('/') ? path : `/${path}`;
        const url = `/api${normalized}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Request failed: HTTP ${res.status}`);
        }
        const payload = (await res.json()) as T;
        if (mountedRef.current && !controller.signal.aborted) {
          setData(payload);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setData(null);
        }
      } finally {
        if (mountedRef.current && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [path, skip, reloadToken]);

  const refetch = useCallback((): void => {
    setReloadToken((token) => token + 1);
  }, []);

  return { data, loading, error, refetch };
}
