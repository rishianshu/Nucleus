import MonacoEditor, { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useMemo } from "react";

export type SmartEditorProps = {
  value: string;
  language: "sql" | "python" | "markdown" | "text";
  theme: "light" | "dark";
  onChange: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  onEditorMount?: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => void;
};

const languageMap: Record<SmartEditorProps["language"], string> = {
  sql: "sql",
  python: "python",
  markdown: "markdown",
  text: "plaintext",
};

const themeMap: Record<SmartEditorProps["theme"], string> = {
  light: "vs",
  dark: "vs-dark",
};

export function SmartEditor({ value, onChange, language, theme, readOnly, className, onEditorMount }: SmartEditorProps) {
  const editorOptions = useMemo(
    () => ({
      fontSize: 13,
      minimap: { enabled: false },
      automaticLayout: true,
      wordWrap: "on" as const,
      renderWhitespace: "all" as const,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      readOnly,
    }),
    [readOnly],
  );

  return (
    <div
      className={`h-full overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-inner dark:border-slate-700 dark:bg-slate-900 ${
        className ?? ""
      }`}
    >
      <MonacoEditor
        height="100%"
        value={value}
        language={languageMap[language]}
        theme={themeMap[theme]}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        onMount={onEditorMount as OnMount | undefined}
        options={editorOptions}
      />
    </div>
  );
}
