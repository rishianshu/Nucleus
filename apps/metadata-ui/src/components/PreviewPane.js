import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
export function PreviewPane({ payload, language }) {
    const content = useMemo(() => {
        if (!payload) {
            return _jsx("p", { className: "text-sm text-slate-500", children: "Run the draft to see preview output." });
        }
        switch (payload.type) {
            case "table":
                return (_jsx("div", { className: "overflow-auto rounded-2xl border border-slate-200 dark:border-slate-800", children: _jsxs("table", { className: "min-w-full divide-y divide-slate-200 text-xs text-slate-700 dark:divide-slate-800 dark:text-slate-200", children: [_jsx("thead", { className: "bg-slate-50 text-[10px] uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/50 dark:text-slate-400", children: _jsx("tr", { children: payload.columns?.map((column) => (_jsx("th", { className: "px-3 py-2 text-left", children: column }, column))) }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800", children: payload.rows?.map((row, rowIndex) => (_jsx("tr", { className: "odd:bg-white even:bg-slate-50 dark:odd:bg-slate-900 dark:even:bg-slate-900/60", children: payload.columns?.map((_, columnIndex) => (_jsx("td", { className: "px-3 py-2", children: row?.[columnIndex] ?? "—" }, `${rowIndex}-${columnIndex}`))) }, `${rowIndex}`))) })] }) }));
            case "markdown":
                return (_jsx("article", { className: "prose prose-sm max-w-none dark:prose-invert", dangerouslySetInnerHTML: { __html: payload.markdown ?? "" } }));
            case "error":
                return _jsx("pre", { className: "rounded-2xl border border-rose-300 bg-rose-50 p-4 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200", children: payload.error });
            case "text":
            default:
                return _jsx("pre", { className: "rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200", children: payload.text ?? "No preview" });
        }
    }, [payload]);
    return (_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center gap-2 text-[11px] uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400", children: ["Preview", _jsx("span", { className: "rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-400 dark:border-slate-700 dark:text-slate-500", children: language.toUpperCase() })] }), content] }));
}
