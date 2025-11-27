import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { CDM_WORK_ITEM_DETAIL_QUERY } from "../metadata/queries";
export function CdmWorkItemDetailView({ metadataEndpoint, authToken }) {
    const { cdmId } = useParams();
    const navigate = useNavigate();
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        let aborted = false;
        async function load() {
            if (!metadataEndpoint || !cdmId) {
                setLoading(false);
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const data = await fetchMetadataGraphQL(metadataEndpoint, CDM_WORK_ITEM_DETAIL_QUERY, { cdmId }, undefined, { token: authToken ?? undefined });
                if (!aborted) {
                    setDetail(data.cdmWorkItem ?? null);
                }
            }
            catch (err) {
                if (!aborted) {
                    setError(err.message);
                }
            }
            finally {
                if (!aborted) {
                    setLoading(false);
                }
            }
        }
        load();
        return () => {
            aborted = true;
        };
    }, [metadataEndpoint, authToken, cdmId]);
    if (!metadataEndpoint) {
        return _jsx("div", { className: "text-sm text-rose-500", children: "Metadata endpoint not configured." });
    }
    if (!cdmId) {
        return _jsx("div", { className: "text-sm text-slate-500", children: "Select a work item from the list." });
    }
    if (loading) {
        return _jsx("div", { className: "text-sm text-slate-500", children: "Loading work item\u2026" });
    }
    if (error) {
        return (_jsxs("div", { className: "space-y-3", children: [_jsx("p", { className: "text-sm text-rose-500", children: error }), _jsx("button", { type: "button", onClick: () => navigate(-1), className: "rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Back" })] }));
    }
    if (!detail) {
        return (_jsxs("div", { className: "space-y-3", children: [_jsx("p", { className: "text-sm text-slate-500", children: "Work item not found." }), _jsx("button", { type: "button", onClick: () => navigate(-1), className: "rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Back" })] }));
    }
    const { item, comments, worklogs } = detail;
    return (_jsxs("div", { "data-testid": "cdm-work-detail", className: "space-y-6", children: [_jsx("button", { type: "button", onClick: () => navigate(-1), className: "rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Back to list" }), _jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: item.sourceSystem }), _jsx("h2", { className: "text-2xl font-semibold text-slate-900 dark:text-white", children: item.summary }), _jsx("p", { className: "text-sm text-slate-500", children: item.sourceIssueKey })] }), _jsxs("div", { className: "text-right text-sm", children: [_jsxs("p", { className: "font-semibold text-slate-700 dark:text-slate-200", children: ["Status: ", item.status ?? "—"] }), _jsxs("p", { className: "text-slate-500", children: ["Priority: ", item.priority ?? "—"] }), _jsxs("p", { className: "text-slate-500", children: ["Project: ", item.projectCdmId] })] })] }), _jsxs("dl", { className: "mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2", children: [_jsxs("div", { children: [_jsx("dt", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Reporter" }), _jsx("dd", { className: "text-slate-900 dark:text-slate-100", children: item.reporter?.displayName ?? "—" })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Assignee" }), _jsx("dd", { className: "text-slate-900 dark:text-slate-100", children: item.assignee?.displayName ?? "—" })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Created" }), _jsx("dd", { children: item.createdAt ? new Date(item.createdAt).toLocaleString() : "—" })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Updated" }), _jsx("dd", { children: item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—" })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Closed" }), _jsx("dd", { children: item.closedAt ? new Date(item.closedAt).toLocaleString() : "—" })] })] })] }), _jsxs("div", { className: "grid gap-6 md:grid-cols-2", children: [_jsxs("section", { className: "rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsxs("header", { className: "mb-3 border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 dark:border-slate-800", children: ["Comments (", comments.length, ")"] }), comments.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "No comments recorded." })) : (_jsx("ul", { className: "space-y-4", children: comments.map((comment) => (_jsxs("li", { className: "rounded-2xl border border-slate-100 p-3 dark:border-slate-800", children: [_jsx("div", { className: "text-sm text-slate-900 dark:text-slate-100", children: comment.body }), _jsxs("div", { className: "mt-2 text-xs text-slate-500", children: [comment.author?.displayName ?? "Unknown", " \u00B7 ", comment.createdAt ? new Date(comment.createdAt).toLocaleString() : "—"] })] }, comment.cdmId))) }))] }), _jsxs("section", { className: "rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsxs("header", { className: "mb-3 border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 dark:border-slate-800", children: ["Worklogs (", worklogs.length, ")"] }), worklogs.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "No worklogs recorded." })) : (_jsx("ul", { className: "space-y-4", children: worklogs.map((log) => (_jsxs("li", { className: "rounded-2xl border border-slate-100 p-3 dark:border-slate-800", children: [_jsx("div", { className: "text-sm text-slate-900 dark:text-slate-100", children: log.timeSpentSeconds ? formatDuration(log.timeSpentSeconds) : "—" }), _jsxs("div", { className: "text-xs text-slate-500", children: [log.author?.displayName ?? "Unknown", " \u00B7 ", log.startedAt ? new Date(log.startedAt).toLocaleString() : "—"] }), log.comment ? _jsx("p", { className: "mt-2 text-sm text-slate-600", children: log.comment }) : null] }, log.cdmId))) }))] })] })] }));
}
function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return "—";
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours === 0) {
        return `${minutes}m`;
    }
    return `${hours}h ${minutes}m`;
}
