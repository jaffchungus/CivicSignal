// Shared async UI state — one owner for "fetch this" and "run this action",
// so pages describe what they load, not how loading works.
import { useCallback, useEffect, useRef, useState } from "react";

import { api, errorDetails } from "./api";

/**
 * Fetches a JSON path, re-fetching whenever the path changes. A path change is
 * a fresh load (data resets, `loading` covers it); `reload()` refreshes in
 * place so acting on data never flashes the page back to a loading state.
 */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(
    (fresh: boolean) => {
      if (path === null) {
        return;
      }
      const ticket = ++request.current;
      if (fresh) {
        setData(null);
        setLoading(true);
      }
      api
        .get<T>(path)
        .then((result) => {
          if (ticket !== request.current) {
            return;
          }
          setData(result);
          setError(null);
        })
        .catch((caught) => {
          if (ticket !== request.current) {
            return;
          }
          setError(errorDetails(caught).message);
        })
        .finally(() => {
          if (ticket !== request.current) {
            return;
          }
          setLoading(false);
        });
    },
    [path],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  const reload = useCallback(() => load(false), [load]);

  return { data, setData, loading, error, reload };
}

/** Runs an async action with pending, validation, error, and confirmation state. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<unknown>, flash?: string) => {
      setPending(true);
      setError(null);
      setFieldErrors({});
      setNotice(null);
      try {
        await action();
        if (flash) {
          setNotice(flash);
        }
      } catch (caught) {
        const details = errorDetails(caught);
        setError(details.message);
        setFieldErrors(details.fieldErrors);
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { pending, error, fieldErrors, notice, run };
}
