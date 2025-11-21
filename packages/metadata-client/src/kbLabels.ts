export type KbLabelKind = "nodeType" | "edgeType";

type LabelEntry = {
  value: string;
  label: string;
};

const NODE_TYPE_LABELS: LabelEntry[] = [
  { value: "catalog.dataset", label: "Datasets" },
  { value: "metadata.endpoint", label: "Endpoints" },
  { value: "doc.page", label: "Doc pages" },
  { value: "doc.article", label: "Doc articles" },
  { value: "dataset.view", label: "Dataset views" },
];

const EDGE_TYPE_LABELS: LabelEntry[] = [
  { value: "DEPENDENCY_OF", label: "Dependency" },
  { value: "DOCUMENTED_BY", label: "Documented by" },
  { value: "RELATED_TO", label: "Related to" },
  { value: "POWERED_BY", label: "Powered by" },
];

const LABEL_TO_VALUE = new Map(
  [...NODE_TYPE_LABELS, ...EDGE_TYPE_LABELS].map((entry) => [entry.label.toLowerCase(), entry.value]),
);

export function resolveKbLabel(value: string, kind: KbLabelKind = "nodeType"): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "";
  }
  const candidates = kind === "edgeType" ? EDGE_TYPE_LABELS : NODE_TYPE_LABELS;
  const match = candidates.find((entry) => entry.value === normalized);
  if (match) {
    return match.label;
  }
  return humanizeKbIdentifier(normalized);
}

export function resolveKbValue(label: string): string | null {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return LABEL_TO_VALUE.get(normalized) ?? null;
}

export function humanizeKbIdentifier(value: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "";
  }
  return normalized
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}
