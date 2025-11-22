import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ViewToggle({ value, onChange, disableGraph }) {
    return (_jsxs("div", { className: "inline-flex rounded-full border border-slate-200 bg-white/70 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300", children: [_jsx("button", { type: "button", className: `rounded-full px-4 py-1 transition ${value === "list" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : ""}`, onClick: () => onChange("list"), "data-testid": "kb-view-list", children: "List" }), _jsx("button", { type: "button", className: `rounded-full px-4 py-1 transition ${value === "graph" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : disableGraph ? "opacity-50" : ""}`, onClick: () => {
                    if (!disableGraph) {
                        onChange("graph");
                    }
                }, disabled: disableGraph, "data-testid": "kb-view-graph", children: "Graph" })] }));
}
