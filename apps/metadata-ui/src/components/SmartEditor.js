import { jsx as _jsx } from "react/jsx-runtime";
import MonacoEditor from "@monaco-editor/react";
import { useMemo } from "react";
const languageMap = {
    sql: "sql",
    python: "python",
    markdown: "markdown",
    text: "plaintext",
};
const themeMap = {
    light: "vs",
    dark: "vs-dark",
};
export function SmartEditor({ value, onChange, language, theme, readOnly, className, onEditorMount }) {
    const editorOptions = useMemo(() => ({
        fontSize: 13,
        minimap: { enabled: false },
        automaticLayout: true,
        wordWrap: "on",
        renderWhitespace: "all",
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        readOnly,
    }), [readOnly]);
    return (_jsx("div", { className: `h-full overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-inner dark:border-slate-700 dark:bg-slate-900 ${className ?? ""}`, children: _jsx(MonacoEditor, { height: "100%", value: value, language: languageMap[language], theme: themeMap[theme], onChange: (nextValue) => onChange(nextValue ?? ""), onMount: onEditorMount, options: editorOptions }) }));
}
