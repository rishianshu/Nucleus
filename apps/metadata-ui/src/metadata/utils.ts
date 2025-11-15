export const previewTableColumns = (rows: Array<Record<string, unknown>>): string[] => {
  if (!rows.length) {
    return [];
  }
  const columns = new Set<string>();
  rows.forEach((row) => {
    if (row && typeof row === "object") {
      Object.keys(row).forEach((key) => columns.add(key));
    }
  });
  return Array.from(columns);
};

export const parseListInput = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
