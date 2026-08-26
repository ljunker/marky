import { useEffect, useRef } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";

interface ConflictResolverProps {
  name: string;
  externalSource: string;
  ownSource: string;
  darkMode: boolean;
  notice?: string;
  onOwnSourceChange: (source: string) => void;
  onCancel: () => void;
  onLoadExternal: () => void;
  onAccept: () => void;
}

export function ConflictResolver({
  name,
  externalSource,
  ownSource,
  darkMode,
  notice,
  onOwnSourceChange,
  onCancel,
  onLoadExternal,
  onAccept,
}: ConflictResolverProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onOwnSourceChange);
  onChangeRef.current = onOwnSourceChange;

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    const common = [
      markdown(),
      lineNumbers(),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        },
      }, { dark: darkMode }),
    ];
    const merge = new MergeView({
      parent,
      a: {
        doc: externalSource,
        extensions: [
          ...common,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      },
      b: {
        doc: ownSource,
        extensions: [
          ...common,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      },
      orientation: "a-b",
      revertControls: "a-to-b",
      renderRevertControl: () => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "merge-revert-button";
        button.title = "Diesen externen Block übernehmen";
        button.setAttribute("aria-label", button.title);
        button.textContent = "→";
        return button;
      },
      collapseUnchanged: { margin: 4, minSize: 8 },
    });
    return () => merge.destroy();
  }, [darkMode, externalSource]);

  return (
    <div className="conflict-backdrop" role="presentation">
      <section
        className="conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
      >
        <header>
          <div>
            <h2 id="conflict-title">Konflikt in {name}</h2>
            <p>Extern links · deine bearbeitbare Fassung rechts</p>
          </div>
          {notice && <span className="conflict-notice">{notice}</span>}
        </header>
        <div ref={parentRef} className="merge-editor" />
        <footer className="dialog-actions">
          <button type="button" onClick={onCancel}>Abbrechen</button>
          <button type="button" onClick={onLoadExternal}>Externe Version laden</button>
          <button type="button" className="button-primary" onClick={onAccept}>
            Zusammengeführte Version übernehmen
          </button>
        </footer>
      </section>
    </div>
  );
}
