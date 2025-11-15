import { useMemo } from "react";

export type PreviewPayload = {
  type: "table" | "markdown" | "text" | "error";
  columns?: string[];
  rows?: Array<Array<string | number | boolean | null>>;
  markdown?: string;
  text?: string;
  error?: string;
};

type PreviewPaneProps = {
  payload: PreviewPayload | null;
  language: "sql" | "python" | "markdown" | "text";
};

export function PreviewPane({ payload, language }: PreviewPaneProps) {
  const content = useMemo(() => {
    if (!payload) {
      return <p className="text-sm text-slate-500">Run the draft to see preview output.</p>;
    }
    switch (payload.type) {
      case "table":
        return (
          <div className="overflow-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200 text-xs text-slate-700 dark:divide-slate-800 dark:text-slate-200">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  {payload.columns?.map((column) => (
                    <th key={column} className="px-3 py-2 text-left">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {payload.rows?.map((row, rowIndex) => (
                  <tr key={`${rowIndex}`} className="odd:bg-white even:bg-slate-50 dark:odd:bg-slate-900 dark:even:bg-slate-900/60">
                    {payload.columns?.map((_, columnIndex) => (
                      <td key={`${rowIndex}-${columnIndex}`} className="px-3 py-2">
                        {row?.[columnIndex] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "markdown":
        return (
          <article className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: payload.markdown ?? "" }} />
        );
      case "error":
        return <pre className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">{payload.error}</pre>;
      case "text":
      default:
        return <pre className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">{payload.text ?? "No preview"}</pre>;
    }
  }, [payload]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">
        Preview
        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-400 dark:border-slate-700 dark:text-slate-500">
          {language.toUpperCase()}
        </span>
      </div>
      {content}
    </div>
  );
}
