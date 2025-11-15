import type * as Monaco from "monaco-editor";

type Annotation = {
  range: Monaco.IRange;
  message: string;
};

export function applyAgentAnnotations(editor: Monaco.editor.IStandaloneCodeEditor, annotations: Annotation[]) {
  const model = editor.getModel();
  if (!model) {
    return;
  }
  const decorationOptions = annotations.map((annotation) => ({
    range: annotation.range,
    options: {
      inlineClassName: "agent-annotation",
      hoverMessage: { value: annotation.message },
    },
  }));
  editor.deltaDecorations([], decorationOptions);
}
