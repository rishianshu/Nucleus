import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useMemo } from "react";
const MetadataContext = createContext(null);
export function MetadataProvider({ datasets, definitions, dashboards, persona, scope, children }) {
    const value = useMemo(() => {
        return {
            datasets,
            datasetMap: new Map(datasets.map((dataset) => [dataset.id, dataset])),
            definitions,
            dashboards,
            persona,
            scope,
        };
    }, [datasets, definitions, dashboards, persona, scope]);
    return _jsx(MetadataContext.Provider, { value: value, children: children });
}
export function useMetadataContext() {
    const ctx = useContext(MetadataContext);
    if (!ctx) {
        throw new Error("useMetadataContext must be used within MetadataProvider");
    }
    return ctx;
}
export function useMetadataScope() {
    const ctx = useMetadataContext();
    const selectedDatasets = ctx.scope.selectedDatasetIds
        .map((id) => ctx.datasetMap.get(id))
        .filter((dataset) => Boolean(dataset));
    return {
        selectedDatasetIds: ctx.scope.selectedDatasetIds,
        selectedDatasets,
        toggleDatasetSelection: ctx.scope.toggleDatasetSelection,
        clearScope: ctx.scope.clearScope,
        persona: ctx.persona,
    };
}
export function useMetadataDataset(datasetId) {
    const ctx = useMetadataContext();
    if (!datasetId) {
        return null;
    }
    return ctx.datasetMap.get(datasetId) ?? null;
}
