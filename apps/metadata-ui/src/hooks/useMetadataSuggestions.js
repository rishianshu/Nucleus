import { useMemo } from "react";
export function useMetadataSuggestions({ datasets, selectedDatasetIds }) {
    const suggestions = useMemo(() => {
        const completions = [];
        const datasetMap = new Map(datasets.map((dataset) => [dataset.id, dataset]));
        const scopedDatasets = selectedDatasetIds.length
            ? selectedDatasetIds
                .map((datasetId) => datasetMap.get(datasetId))
                .filter((dataset) => Boolean(dataset))
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
