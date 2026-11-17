// Stand-in for https://framer.com/edit/init.mjs (Framer's signed-in editor bar).
// The static mirror has no editor, so the bar renders nothing.
export function createEditorBar() {
  return function EditorBar() {
    return null;
  };
}
