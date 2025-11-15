import { useMemo } from "react";
import { MetadataDataset } from "../metadata/MetadataContext";

type Completion = {
  label: string;
  insertText: string;
  detail?: string;
  kind: "table" | "column" | "macro";
  datasetId?: string;
  field?: string;
};

type UseMetadataSuggestionsParams = {
  datasets: MetadataDataset[];
  selectedDatasetIds: string[];
};

export function useMetadataSuggestions({ datasets, selectedDatasetIds }: UseMetadataSuggestionsParams) {
  const suggestions = useMemo(() => {
    const completions: Completion[] = [];
    const datasetMap = new Map(datasets.map((dataset) => [dataset.id, dataset]));

    const scopedDatasets = selectedDatasetIds.length
      ? selectedDatasetIds
          .map((datasetId) => datasetMap.get(datasetId))
          .filter((dataset): dataset is MetadataDataset => Boolean(dataset))
      : datasets;

    scopedDatasets.forEach((dataset) => {
      completions.push({
        label: dataset.displayName,
        insertText: dataset.displayName,
        detail: dataset.description ?? dataset.source ?? undefined,
        kind: "table",
        datasetId: dataset.id,
      });
      dataset.fields.forEach((field) => {
        completions.push({
          label: `${dataset.displayName}.${field.name}`,
          insertText: `${dataset.displayName}.${field.name}`,
          detail: field.description ?? field.type,
          kind: "column",
          datasetId: dataset.id,
          field: field.name,
        });
      });
    });

    return completions;
  }, [datasets, selectedDatasetIds]);

  return suggestions;
}
