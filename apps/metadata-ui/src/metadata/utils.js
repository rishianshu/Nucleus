export const previewTableColumns = (rows) => {
    if (!rows.length) {
        return [];
    }
    const columns = new Set();
    rows.forEach((row) => {
        if (row && typeof row === "object") {
            Object.keys(row).forEach((key) => columns.add(key));
        }
    });
    return Array.from(columns);
};
export const parseListInput = (value) => value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
