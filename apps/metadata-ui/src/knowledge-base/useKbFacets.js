import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMetadataGraphQL } from "../metadata/api";
import { KB_FACETS_QUERY } from "./queries";
export function useKbFacets(metadataEndpoint, token, scope) {
    const [facets, setFacets] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const scopeKey = useMemo(() => JSON.stringify(scope ?? {}), [scope?.projectId ?? null, scope?.domainId ?? null, scope?.teamId ?? null]);
    const fetchFacets = useCallback(async () => {
        if (!metadataEndpoint) {
            setFacets(null);
            setError("Metadata endpoint unavailable.");
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const payload = await fetchMetadataGraphQL(metadataEndpoint, KB_FACETS_QUERY, scope ? { scope } : undefined, undefined, { token: token ?? undefined });
            setFacets(payload.kbFacets);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }, [metadataEndpoint, token, scopeKey]);
    useEffect(() => {
        void fetchFacets();
    }, [fetchFacets]);
    return {
        facets,
        loading,
        error,
        refresh: fetchFacets,
    };
}
