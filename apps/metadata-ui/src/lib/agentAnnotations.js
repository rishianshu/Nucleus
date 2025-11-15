export function applyAgentAnnotations(editor, annotations) {
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
