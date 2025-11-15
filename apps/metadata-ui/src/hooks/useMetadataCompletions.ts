import { useMemo } from "react";
import { MetadataDataset } from "../metadata/MetadataContext";

type CompletionItem = {
  label: string;
  insertText: string;
  detail?: string;
  documentation?: string;
  kind: "table" | "column" | "macro";
  filterText?: string;
};

export type MetadataMacro = {
  name: string;
  description?: string | null;
};

type UseMetadataCompletionsParams = {
  datasets: MetadataDataset[];
  selectedDatasetIds: string[];
  macros?: MetadataMacro[];
};

export function useMetadataCompletions({ datasets, selectedDatasetIds, macros = [] }: UseMetadataCompletionsParams) {
  return useMemo(() => {
    const completions: CompletionItem[] = [];
    const datasetMap = new Map(datasets.map((dataset) => [dataset.id, dataset]));
    const scopedDatasets = selectedDatasetIds.length
      ? selectedDatasetIds.map((datasetId) => datasetMap.get(datasetId)).filter((dataset): dataset is MetadataDataset => Boolean(dataset))
      : datasets;

    const normalizeDatasetName = (dataset: MetadataDataset) => {
      if (dataset.source && dataset.source.trim().length) {
        return dataset.source.trim();
      }
      return dataset.id;
    };

    scopedDatasets.forEach((dataset) => {
      const normalizedName = normalizeDatasetName(dataset);
      completions.push({
        label: normalizedName,
        insertText: normalizedName,
        detail: dataset.displayName,
        documentation: dataset.description ?? undefined,
        kind: "table",
        filterText: `${dataset.displayName} ${dataset.id}`,
      });
      dataset.fields.forEach((field) => {
        completions.push({
          label: `${normalizedName}.${field.name}`,
          insertText: `${normalizedName}.${field.name}`,
          detail: `${dataset.displayName}.${field.name}`,
          documentation: field.description ?? undefined,
          kind: "column",
          filterText: `${dataset.displayName}.${field.name}`,
        });
      });
    });

    macros.forEach((macro) => {
      completions.push({
        label: `ref:${macro.name}`,
        insertText: `{{ ref('${macro.name}') }}`,
        detail: "dbt model",
        documentation: macro.description ?? undefined,
        kind: "macro",
      });
    });

    return completions;
  }, [datasets, selectedDatasetIds, macros]);
}
