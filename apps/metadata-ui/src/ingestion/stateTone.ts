import type { IngestionState } from "../metadata/types";

export const ingestionStateTone: Record<
  IngestionState,
  { label: string; badge: string; dot: string }
> = {
  RUNNING: {
    label: "Running",
    badge: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/60 dark:bg-sky-500/10 dark:text-sky-100",
    dot: "bg-sky-500 animate-pulse",
  },
  SUCCEEDED: {
    label: "Healthy",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-100",
    dot: "bg-emerald-500",
  },
  FAILED: {
    label: "Failed",
    badge: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100",
    dot: "bg-rose-500 animate-pulse",
  },
  PAUSED: {
    label: "Paused",
    badge: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-50",
    dot: "bg-amber-500",
  },
  IDLE: {
    label: "Idle",
    badge: "border-slate-200 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
    dot: "bg-slate-400",
  },
};

export function formatIngestionMode(mode?: string | null) {
  const normalized = typeof mode === "string" ? mode : "FULL";
  return normalized.toUpperCase();
}

export function formatIngestionSchedule(kind?: string | null, interval?: number | null) {
  const normalized = (kind ?? "MANUAL").toUpperCase();
  if (normalized === "INTERVAL") {
    const minutes = typeof interval === "number" && !Number.isNaN(interval) ? Math.max(1, Math.trunc(interval)) : 15;
    return `Every ${minutes} min`;
  }
  return "Manual only";
}

export function formatIngestionSink(sinkId?: string | null) {
  const normalized = typeof sinkId === "string" && sinkId.trim().length > 0 ? sinkId : "kb";
  return normalized.toUpperCase();
}

export function summarizePolicy(policy?: Record<string, unknown> | null) {
  if (!policy || typeof policy !== "object") {
    return [];
  }
  const segments: string[] = [];
  const record = policy as Record<string, unknown>;
  const cursor = typeof record["cursorField"] === "string" ? (record["cursorField"] as string) : null;
  if (cursor) {
    segments.push(`Cursor · ${cursor}`);
  }
  const primaryKeys = Array.isArray(record["primaryKeys"])
    ? (record["primaryKeys"] as unknown[]).filter((value: unknown): value is string => typeof value === "string")
    : [];
  if (primaryKeys.length > 0) {
    segments.push(`PK · ${primaryKeys.join(", ")}`);
  }
  return segments;
}
