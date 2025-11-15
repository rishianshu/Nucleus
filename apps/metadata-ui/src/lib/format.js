export const formatDateTime = (value) => new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
});
export const formatRelativeTime = (value) => {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
        return "";
    }
    const diffMs = Date.now() - timestamp;
    const minutes = Math.round(diffMs / 60000);
    if (Math.abs(minutes) < 1) {
        return "just now";
    }
    if (Math.abs(minutes) < 60) {
        return `${minutes}m ago`;
    }
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) {
        return `${hours}h ago`;
    }
    const days = Math.round(hours / 24);
    return `${days}d ago`;
};
export const formatPreviewValue = (value) => {
    if (value === null || value === undefined) {
        return "—";
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value.toLocaleString() : String(value);
    }
    if (typeof value === "boolean") {
        return value ? "Yes" : "No";
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        }
        catch {
            return "[object]";
        }
    }
    return String(value);
};
