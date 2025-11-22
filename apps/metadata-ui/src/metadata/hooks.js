import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMetadataGraphQL } from "./api";
import { CATALOG_DATASETS_CONNECTION_QUERY } from "./queries";
export function useAsyncAction(action, options) {
    const actionRef = useRef(action);
    actionRef.current = action;
    const [state, setState] = useState("idle");
    const [error, setError] = useState(null);
    const run = useCallback(async (...args) => {
        setState("pending");
        setError(null);
        try {
            const result = await actionRef.current(...args);
            setState("success");
            options?.onSuccess?.(result);
            return result;
        }
        catch (err) {
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
export function useDebouncedValue(value, delay = 300) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const handle = window.setTimeout(() => setDebounced(value), delay);
        return () => {
            window.clearTimeout(handle);
        };
    }, [value, delay]);
    return debounced;
}
const EMPTY_PAGE_INFO = {
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
};
export function usePagedQuery(options) {
    const { metadataEndpoint, token, query, variables, pageSize = 25, selectConnection, deps = [] } = options;
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isRefetching, setIsRefetching] = useState(false);
    const [error, setError] = useState(null);
    const [pageInfo, setPageInfo] = useState(() => ({ ...EMPTY_PAGE_INFO }));
    const abortRef = useRef(0);
    const itemsRef = useRef([]);
    const runQuery = useCallback(async (cursor, append) => {
        if (!metadataEndpoint || !token) {
            abortRef.current += 1;
            itemsRef.current = [];
            setItems([]);
            setPageInfo(() => ({ ...EMPTY_PAGE_INFO }));
            setError(null);
            setLoading(false);
            setIsRefetching(false);
            return;
        }
        const requestId = ++abortRef.current;
        const hasItems = itemsRef.current.length > 0;
        if (!append && hasItems) {
            setIsRefetching(true);
        }
        else {
            setLoading(true);
        }
        setError(null);
        try {
            const payload = await fetchMetadataGraphQL(metadataEndpoint, query, {
                ...(variables ?? {}),
                first: pageSize,
                after: cursor ?? undefined,
            }, undefined, { token: token ?? undefined });
            if (requestId !== abortRef.current) {
                return;
            }
            const connection = selectConnection(payload);
            const nodes = connection?.nodes ?? [];
            const nextItems = append ? [...itemsRef.current, ...nodes] : nodes;
            itemsRef.current = nextItems;
            setItems(nextItems);
            setPageInfo((prev) => {
                const raw = connection?.pageInfo ?? {};
                const derivedStart = append ? prev.startCursor : raw.startCursor ?? prev.startCursor ?? null;
                const derivedEnd = raw.endCursor ?? prev.endCursor ?? null;
                return {
                    hasNextPage: Boolean(raw.hasNextPage),
                    hasPreviousPage: append ? true : Boolean(raw.hasPreviousPage),
                    startCursor: derivedStart,
                    endCursor: derivedEnd,
                };
            });
        }
        catch (err) {
            if (requestId !== abortRef.current) {
                return;
            }
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            if (!itemsRef.current.length) {
                setItems([]);
                setPageInfo(() => ({ ...EMPTY_PAGE_INFO }));
            }
        }
        finally {
            if (requestId === abortRef.current) {
                setLoading(false);
                setIsRefetching(false);
            }
        }
    }, [metadataEndpoint, token, query, variables, pageSize, selectConnection]);
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
        isRefetching,
        error,
        pageInfo,
        fetchNext,
        refresh,
    };
}
export function useCatalogDatasetConnection(options) {
    const { metadataEndpoint, token, endpointId, label, search, unlabeledOnly = false, pageSize = 25 } = options;
    const baseVariables = useMemo(() => ({
        endpointId: endpointId ?? undefined,
        labels: label ? [label] : undefined,
        search,
        unlabeledOnly: unlabeledOnly ? true : undefined,
    }), [endpointId, label, search, unlabeledOnly]);
    const selectCatalogConnection = useCallback((payload) => payload.catalogDatasetConnection, []);
    const paged = usePagedQuery({
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
export function useToastQueue() {
    const [toasts, setToasts] = useState([]);
    const counterRef = useRef(0);
    const timeoutsRef = useRef({});
    const schedule = typeof window === "undefined" ? globalThis : window;
    const dismissToast = useCallback((id) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
        const timeoutId = timeoutsRef.current[id];
        if (timeoutId) {
            schedule.clearTimeout(timeoutId);
            delete timeoutsRef.current[id];
        }
    }, [schedule]);
    const pushToast = useCallback((options) => {
        const id = `toast-${Date.now()}-${++counterRef.current}`;
        const duration = options.durationMs ?? 6000;
        const record = {
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
    }, [dismissToast, schedule]);
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
