import { useCallback, useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { openSearchPanel } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  Bold,
  Code2,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  Table2,
} from "lucide-react";
import {
  createMarkdownEdit,
  type MarkdownAction,
} from "../lib/formatting";
import type { DocumentState } from "../types";

const formatGroups = [
  [
    { action: "bold", label: "Fett", shortcut: "⌘B", Icon: Bold },
    { action: "italic", label: "Kursiv", shortcut: "⌘I", Icon: Italic },
    {
      action: "strike",
      label: "Durchgestrichen",
      shortcut: "",
      Icon: Strikethrough,
    },
    { action: "code", label: "Inline-Code", shortcut: "", Icon: Code2 },
  ],
  [
    { action: "heading", label: "Überschrift", shortcut: "", Icon: Heading2 },
    { action: "bulletList", label: "Aufzählung", shortcut: "", Icon: List },
    {
      action: "orderedList",
      label: "Nummerierte Liste",
      shortcut: "",
      Icon: ListOrdered,
    },
    {
      action: "taskList",
      label: "Aufgabenliste",
      shortcut: "",
      Icon: ListChecks,
    },
    { action: "quote", label: "Zitat", shortcut: "", Icon: Quote },
  ],
  [
    { action: "link", label: "Link", shortcut: "", Icon: LinkIcon },
    { action: "image", label: "Bild", shortcut: "", Icon: ImageIcon },
    { action: "table", label: "Tabelle", shortcut: "", Icon: Table2 },
  ],
] satisfies Array<
  Array<{
    action: MarkdownAction;
    label: string;
    shortcut: string;
    Icon: typeof Bold;
  }>
>;

interface CodeEditorProps {
  document: DocumentState;
  darkMode: boolean;
  findRequest: number;
  onChange: (source: string) => void;
  onPositionChange: (cursor: number, scrollTop: number) => void;
}

export function CodeEditor({
  document,
  darkMode,
  findRequest,
  onChange,
  onPositionChange,
}: CodeEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const positionRef = useRef({
    cursor: document.cursor,
    scrollTop: document.scrollTop,
  });

  const performAction = useCallback((action: MarkdownAction) => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const edit = createMarkdownEdit(
      view.state.doc.toString(),
      selection.from,
      selection.to,
      action,
    );
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: EditorSelection.range(edit.selectionFrom, edit.selectionTo),
      scrollIntoView: true,
      userEvent: "input.markdown-format",
    });
    view.focus();
  }, []);

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: "Mod-b",
          preventDefault: true,
          run: () => {
            performAction("bold");
            return true;
          },
        },
        {
          key: "Mod-i",
          preventDefault: true,
          run: () => {
            performAction("italic");
            return true;
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          positionRef.current.cursor = update.state.selection.main.head;
          const scrollTop = update.view.scrollDOM.scrollTop;
          positionRef.current.scrollTop = scrollTop;
          onPositionChange(positionRef.current.cursor, scrollTop);
        }
      }),
      EditorView.domEventHandlers({
        scroll: (_event, view) => {
          positionRef.current.scrollTop = view.scrollDOM.scrollTop;
          onPositionChange(
            view.state.selection.main.head,
            positionRef.current.scrollTop,
          );
        },
      }),
    ],
    [onPositionChange, performAction],
  );

  useEffect(() => {
    if (!findRequest || !viewRef.current) return;
    viewRef.current.focus();
    openSearchPanel(viewRef.current);
  }, [findRequest]);

  return (
    <div className="editor-surface">
      <div className="format-toolbar" role="toolbar" aria-label="Markdown formatieren">
        {formatGroups.map((group, groupIndex) => (
          <div className="format-group" key={groupIndex}>
            {group.map(({ action, label, shortcut, Icon }) => (
              <button
                key={action}
                type="button"
                aria-label={label}
                title={shortcut ? `${label} (${shortcut})` : label}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => performAction(action)}
              >
                <Icon size={15} strokeWidth={1.8} />
              </button>
            ))}
          </div>
        ))}
      </div>
      <CodeMirror
        className="code-editor"
        value={document.source}
        height="100%"
        theme={darkMode ? "dark" : "light"}
        extensions={extensions}
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
          const cursor = Math.min(document.cursor, view.state.doc.length);
          view.dispatch({ selection: { anchor: cursor } });
          requestAnimationFrame(() => {
            view.scrollDOM.scrollTop = document.scrollTop;
          });
        }}
        basicSetup={{
          autocompletion: false,
          bracketMatching: true,
          closeBrackets: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          lineNumbers: true,
          searchKeymap: true,
        }}
      />
    </div>
  );
}
