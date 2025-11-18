import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMetadataGraphQL } from "./api";
import { CATALOG_DATASETS_CONNECTION_QUERY } from "./queries";
import type { CatalogDataset } from "./types";

export type AsyncActionState = "idle" | "pending" | "success" | "error";

export function useAsyncAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
  options?: { onSuccess?: (result: TResult) => void; onError?: (error: Error) => void },
) {
  const actionRef = useRef(action);
  actionRef.current = action;
  const [state, setState] = useState<AsyncActionState>("idle");
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(async (...args: TArgs) => {
    setState("pending");
    setError(null);
    try {
      const result = await actionRef.current(...args);
      setState("success");
      options?.onSuccess?.(result);
      return result;
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err));
      setError(normalized);
      setState("error");
      options?.onError?.(normalized);
      throw normalized;
    }
  }, [options]);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  return {
    run,
    state,
    error,
    isPending: state === "pending",
    reset,
  };
}

export function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delay);
    return () => {
      window.clearTimeout(handle);
    };
  }, [value, delay]);
  return debounced;
}

type PageInfoState = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
};

const EMPTY_PAGE_INFO: PageInfoState = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

type UsePagedQueryOptions<TResult> = {
  metadataEndpoint: string | null;
  token?: string | null;
  query: string;
  variables?: Record<string, unknown>;
  pageSize?: number;
  selectConnection: (payload: any) =>
    | {
        nodes?: TResult[];
        pageInfo?: Partial<PageInfoState>;
      }
    | null
    | undefined;
  deps?: ReadonlyArray<unknown>;
};

export type UsePagedQueryResult<TResult> = {
  items: TResult[];
  loading: boolean;
  error: string | null;
  pageInfo: PageInfoState;
  fetchNext: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function usePagedQuery<TResult>(options: UsePagedQueryOptions<TResult>): UsePagedQueryResult<TResult> {
  const { metadataEndpoint, token, query, variables, pageSize = 25, selectConnection, deps = [] } = options;
  const [items, setItems] = useState<TResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageInfo, setPageInfo] = useState<PageInfoState>(() => ({ ...EMPTY_PAGE_INFO }));
  const abortRef = useRef(0);

  const runQuery = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (!metadataEndpoint || !token) {
        abortRef.current += 1;
        setItems([]);
        setPageInfo(() => ({ ...EMPTY_PAGE_INFO }));
        setError(null);
        setLoading(false);
        return;
      }
      const requestId = ++abortRef.current;
      setLoading(true);
      setError(null);
      try {
        const payload = await fetchMetadataGraphQL<any>(
          metadataEndpoint,
          query,
          {
            ...(variables ?? {}),
            first: pageSize,
            after: cursor ?? undefined,
          },
          undefined,
          { token: token ?? undefined },
        );
        if (requestId !== abortRef.current) {
          return;
        }
        const connection = selectConnection(payload);
        const nodes = connection?.nodes ?? [];
        setItems((prev) => (append ? [...prev, ...nodes] : nodes));
        setPageInfo((prev) => {
          const raw = connection?.pageInfo ?? {};
          const derivedStart = append ? prev.startCursor : raw.startCursor ?? nodes[0]?.id ?? null;
          const derivedEnd = raw.endCursor ?? nodes[nodes.length - 1]?.id ?? prev.endCursor ?? null;
          return {
            hasNextPage: Boolean(raw.hasNextPage),
            hasPreviousPage: append ? true : Boolean(raw.hasPreviousPage),
            startCursor: derivedStart,
            endCursor: derivedEnd,
          };
        });
      } catch (err) {
        if (requestId !== abortRef.current) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setItems([]);
        setPageInfo(() => ({ ...EMPTY_PAGE_INFO }));
      } finally {
        if (requestId === abortRef.current) {
          setLoading(false);
        }
      }
    },
    [metadataEndpoint, token, query, variables, pageSize, selectConnection],
  );

  useEffect(() => {
    abortRef.current += 1;
    void runQuery(null, false);
  }, [runQuery, ...deps]);

  const refresh = useCallback(async () => {
    abortRef.current += 1;
    await runQuery(null, false);
  }, [runQuery]);

  const fetchNext = useCallback(async () => {
    if (!pageInfo.hasNextPage || !pageInfo.endCursor || loading) {
      return;
    }
    await runQuery(pageInfo.endCursor, true);
  }, [pageInfo.hasNextPage, pageInfo.endCursor, loading, runQuery]);

  return {
    items,
    loading,
    error,
    pageInfo,
    fetchNext,
    refresh,
  };
}

type CatalogConnectionOptions = {
  metadataEndpoint: string | null;
  token?: string | null;
  endpointId?: string | null;
  label?: string | null;
  search?: string | null;
  unlabeledOnly?: boolean;
  pageSize?: number;
};

type CatalogConnectionState = {
  datasets: CatalogDataset[];
  loading: boolean;
  error: string | null;
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  fetchNext: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function useCatalogDatasetConnection(options: CatalogConnectionOptions): CatalogConnectionState {
  const { metadataEndpoint, token, endpointId, label, search, unlabeledOnly = false, pageSize = 25 } = options;
  const baseVariables = useMemo(
    () => ({
      endpointId: endpointId ?? undefined,
      labels: label ? [label] : undefined,
      search,
      unlabeledOnly: unlabeledOnly ? true : undefined,
    }),
    [endpointId, label, search, unlabeledOnly],
  );
  const selectCatalogConnection = useCallback(
    (payload: { catalogDatasetConnection?: { nodes?: CatalogDataset[]; pageInfo?: Partial<PageInfoState> } }) =>
      payload.catalogDatasetConnection,
    [],
  );
  const paged = usePagedQuery<CatalogDataset>({
    metadataEndpoint,
    token,
    query: CATALOG_DATASETS_CONNECTION_QUERY,
    variables: baseVariables,
    pageSize,
    selectConnection: selectCatalogConnection,
  });
  return {
    datasets: paged.items,
    loading: paged.loading,
    error: paged.error,
    pageInfo: paged.pageInfo,
    fetchNext: paged.fetchNext,
    refresh: paged.refresh,
  };
}

export type ToastIntent = "info" | "success" | "error";

export type ToastRecord = {
  id: string;
  title: string;
  description?: string;
  intent: ToastIntent;
};

type ToastOptions = {
  title: string;
  description?: string;
  intent?: ToastIntent;
  durationMs?: number;
};

export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const counterRef = useRef(0);
  const timeoutsRef = useRef<Record<string, number>>({});
  const schedule = typeof window === "undefined" ? globalThis : window;

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timeoutId = timeoutsRef.current[id];
    if (timeoutId) {
      schedule.clearTimeout(timeoutId);
      delete timeoutsRef.current[id];
    }
  }, [schedule]);

  const pushToast = useCallback(
    (options: ToastOptions) => {
      const id = `toast-${Date.now()}-${++counterRef.current}`;
      const duration = options.durationMs ?? 6000;
      const record: ToastRecord = {
        id,
        title: options.title,
        description: options.description,
        intent: options.intent ?? "info",
      };
      setToasts((prev) => [...prev, record]);
      if (duration > 0) {
        timeoutsRef.current[id] = schedule.setTimeout(() => dismissToast(id), duration);
      }
      return id;
    },
    [dismissToast, schedule],
  );

  useEffect(() => {
    return () => {
      Object.values(timeoutsRef.current).forEach((timeoutId) => {
        schedule.clearTimeout(timeoutId);
      });
      timeoutsRef.current = {};
    };
  }, [schedule]);

  return {
    toasts,
    pushToast,
    dismissToast,
  };
}
