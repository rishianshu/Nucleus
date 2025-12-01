const DOC_DATASET_HINTS = ["confluence.", "onedrive.", "sharepoint.", "doc."];

const DOC_DATASET_LABEL_OVERRIDES: Record<string, string> = {
  "confluence.page": "Confluence Pages",
  "confluence.pages": "Confluence Pages",
  "confluence.docs": "Confluence Documents",
  "onedrive.item": "OneDrive Files",
  "onedrive.items": "OneDrive Files",
  "onedrive.file": "OneDrive Files",
  "onedrive.files": "OneDrive Files",
};

export function describeDocDataset(datasetId?: string | null): string | null {
  if (!datasetId) {
    return null;
  }
  const normalized = datasetId.toLowerCase();
  if (DOC_DATASET_LABEL_OVERRIDES[normalized]) {
    return DOC_DATASET_LABEL_OVERRIDES[normalized];
  }
  const tokens = datasetId.split(/[\.\-_]/).filter(Boolean);
  if (!tokens.length) {
    return datasetId;
  }
  return tokens
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function inferDocSourceSystem(datasetId?: string | null, fallback?: string | null): string {
  if (!datasetId) {
    return fallback ?? "docs";
  }
  const [prefix] = datasetId.split(".");
  if (prefix) {
    return prefix.toLowerCase();
  }
  return fallback ?? "docs";
}

export function isDocDatasetId(datasetId?: string | null, unitId?: string | null): boolean {
  const haystack = `${datasetId ?? ""}|${unitId ?? ""}`.toLowerCase();
  return DOC_DATASET_HINTS.some((hint) => haystack.includes(hint));
}
