import { createContext, ReactNode, useContext, useMemo } from "react";

export type MetadataDatasetField = {
  name: string;
  type: string;
  description?: string | null;
};

export type MetadataDataset = {
  id: string;
  displayName: string;
  description?: string | null;
  source?: string | null;
  fields: MetadataDatasetField[];
};

export type MetadataDefinition = {
  id: string;
  name: string;
  personaTags: string[];
};

export type MetadataDashboard = MetadataDefinition;

type MetadataScope = {
  selectedDatasetIds: string[];
  toggleDatasetSelection: (datasetId: string) => void;
  clearScope: () => void;
};

type MetadataContextValue = {
  datasets: MetadataDataset[];
  datasetMap: Map<string, MetadataDataset>;
  definitions: MetadataDefinition[];
  dashboards: MetadataDashboard[];
  persona: string | null;
  scope: MetadataScope;
};

type MetadataProviderProps = {
  datasets: MetadataDataset[];
  definitions: MetadataDefinition[];
  dashboards: MetadataDashboard[];
  persona: string | null;
  scope: MetadataScope;
  children: ReactNode;
};

const MetadataContext = createContext<MetadataContextValue | null>(null);

export function MetadataProvider({ datasets, definitions, dashboards, persona, scope, children }: MetadataProviderProps) {
  const value = useMemo<MetadataContextValue>(() => {
    return {
      datasets,
      datasetMap: new Map(datasets.map((dataset) => [dataset.id, dataset])),
      definitions,
      dashboards,
      persona,
      scope,
    };
  }, [datasets, definitions, dashboards, persona, scope]);

  return <MetadataContext.Provider value={value}>{children}</MetadataContext.Provider>;
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
    .filter((dataset): dataset is MetadataDataset => Boolean(dataset));
  return {
    selectedDatasetIds: ctx.scope.selectedDatasetIds,
    selectedDatasets,
    toggleDatasetSelection: ctx.scope.toggleDatasetSelection,
    clearScope: ctx.scope.clearScope,
    persona: ctx.persona,
  };
}

export function useMetadataDataset(datasetId: string | null | undefined) {
  const ctx = useMetadataContext();
  if (!datasetId) {
    return null;
  }
  return ctx.datasetMap.get(datasetId) ?? null;
}
