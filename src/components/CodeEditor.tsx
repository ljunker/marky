import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { openSearchPanel } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { listen } from "@tauri-apps/api/event";
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
import { cancelImageDrop, importImageFile, saveImageBytes } from "../api";
import {
  createImageMarkdown,
  createListContinuationEdit,
  createSmartUrlPasteEdit,
} from "../lib/editorInput";
import { createMarkdownEdit, type MarkdownAction } from "../lib/formatting";
import type {
  DocumentState,
  ImageDropPayload,
  ImportedAsset,
  ScrollAnchor,
} from "../types";

const formatGroups = [
  [
    { action: "bold", label: "Fett", shortcut: "⌘B", Icon: Bold },
    { action: "italic", label: "Kursiv", shortcut: "⌘I", Icon: Italic },
    { action: "strike", label: "Durchgestrichen", shortcut: "", Icon: Strikethrough },
    { action: "code", label: "Inline-Code", shortcut: "", Icon: Code2 },
  ],
  [
    { action: "heading", label: "Überschrift", shortcut: "", Icon: Heading2 },
    { action: "bulletList", label: "Aufzählung", shortcut: "", Icon: List },
    { action: "orderedList", label: "Nummerierte Liste", shortcut: "", Icon: ListOrdered },
    { action: "taskList", label: "Aufgabenliste", shortcut: "", Icon: ListChecks },
    { action: "quote", label: "Zitat", shortcut: "", Icon: Quote },
  ],
  [
    { action: "link", label: "Link", shortcut: "", Icon: LinkIcon },
    { action: "image", label: "Bild", shortcut: "", Icon: ImageIcon },
    { action: "table", label: "Tabelle", shortcut: "", Icon: Table2 },
  ],
] satisfies Array<Array<{
  action: MarkdownAction;
  label: string;
  shortcut: string;
  Icon: typeof Bold;
}>>;

export interface CodeEditorHandle {
  revealOffset: (offset: number) => void;
  revealRange: (from: number, to: number) => void;
  scrollToSource: (anchor: ScrollAnchor) => void;
  replaceSource: (source: string) => void;
}

interface CodeEditorProps {
  document: DocumentState;
  darkMode: boolean;
  findRequest: number;
  typewriterMode: boolean;
  onChange: (source: string) => void;
  onPositionChange: (
    selectionFrom: number,
    selectionTo: number,
    scrollTop: number,
  ) => void;
  onEnsureSaved: () => Promise<string | null>;
  onScrollAnchor: (anchor: ScrollAnchor) => void;
  onError: (message: string) => void;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    {
      document,
      darkMode,
      findRequest,
      typewriterMode,
      onChange,
      onPositionChange,
      onEnsureSaved,
      onScrollAnchor,
      onError,
    },
    forwardedRef,
  ) {
    const viewRef = useRef<EditorView | null>(null);
    const positionRef = useRef({
      selectionFrom: document.selectionFrom,
      selectionTo: document.selectionTo,
      scrollTop: document.scrollTop,
    });

    useImperativeHandle(forwardedRef, () => ({
      revealOffset(offset: number) {
        const view = viewRef.current;
        if (!view) return;
        const position = Math.min(Math.max(0, offset), view.state.doc.length);
        view.dispatch({
          selection: EditorSelection.cursor(position),
          effects: EditorView.scrollIntoView(position, { y: "center" }),
        });
        view.focus();
      },
      revealRange(from: number, to: number) {
        const view = viewRef.current;
        if (!view) return;
        const safeFrom = Math.min(Math.max(0, from), view.state.doc.length);
        const safeTo = Math.min(Math.max(safeFrom, to), view.state.doc.length);
        view.dispatch({
          selection: EditorSelection.range(safeFrom, safeTo),
          effects: EditorView.scrollIntoView(safeFrom, { y: "center" }),
        });
        view.focus();
      },
      scrollToSource(anchor: ScrollAnchor) {
        const view = viewRef.current;
        if (!view) return;
        const lineNumber = Math.min(
          view.state.doc.lines,
          Math.max(1, anchor.line),
        );
        const line = view.state.doc.line(lineNumber);
        view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "start" }) });
        if (anchor.fraction > 0) {
          requestAnimationFrame(() => {
            const block = view.lineBlockAt(line.from);
            view.scrollDOM.scrollTop += block.height * anchor.fraction;
          });
        }
      },
      replaceSource(source: string) {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: source },
          selection: EditorSelection.cursor(Math.min(source.length, view.state.selection.main.head)),
          userEvent: "input.merge",
        });
      },
    }), []);

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
      dispatchEdit(view, edit, "input.markdown-format");
      view.focus();
    }, []);

    const insertImportedAssets = useCallback(
      async (
        importAssets: (documentPath: string) => Promise<ImportedAsset[]>,
        from: number,
        to: number,
        onCancel?: () => Promise<void>,
      ) => {
        try {
          const documentPath = await onEnsureSaved();
          if (!documentPath) {
            await onCancel?.();
            return;
          }
          const assets = await importAssets(documentPath);
          const view = viewRef.current;
          if (!view || assets.length === 0) return;
          const safeFrom = Math.min(from, view.state.doc.length);
          const safeTo = Math.min(Math.max(safeFrom, to), view.state.doc.length);
          const selected = view.state.sliceDoc(safeFrom, safeTo);
          const insert = createImageMarkdown(assets, selected);
          dispatchEdit(view, {
            from: safeFrom,
            to: safeTo,
            insert,
            selectionFrom: safeFrom + insert.length,
            selectionTo: safeFrom + insert.length,
          }, "input.drop");
          view.focus();
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
        }
      },
      [onEnsureSaved, onError],
    );

    const importClipboardImages = useCallback(
      (files: File[], from: number, to: number) =>
        insertImportedAssets(async (documentPath) => {
          const assets: ImportedAsset[] = [];
          for (const file of files) {
            const base64 = await fileToBase64(file);
            assets.push(await saveImageBytes(documentPath, file.type, base64));
          }
          return assets;
        }, from, to),
      [insertImportedAssets],
    );

    const extensions = useMemo(
      () => [
        markdown(),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Enter",
            run: (view) => {
              if (view.state.selection.ranges.length !== 1) return false;
              const selection = view.state.selection.main;
              const edit = createListContinuationEdit(
                view.state.doc.toString(),
                selection.from,
                selection.to,
              );
              if (!edit) return false;
              dispatchEdit(view, edit, "input.type");
              return true;
            },
          },
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
            const selection = update.state.selection.main;
            positionRef.current.selectionFrom = selection.from;
            positionRef.current.selectionTo = selection.to;
            const scrollTop = update.view.scrollDOM.scrollTop;
            positionRef.current.scrollTop = scrollTop;
            onPositionChange(selection.from, selection.to, scrollTop);
            if (typewriterMode) {
              const head = selection.head;
              requestAnimationFrame(() => {
                if (viewRef.current === update.view) {
                  update.view.dispatch({
                    effects: EditorView.scrollIntoView(head, { y: "center" }),
                  });
                }
              });
            }
          }
        }),
        EditorView.domEventHandlers({
          scroll: (_event, view) => {
            const selection = view.state.selection.main;
            positionRef.current.scrollTop = view.scrollDOM.scrollTop;
            onPositionChange(
              selection.from,
              selection.to,
              positionRef.current.scrollTop,
            );
            const anchor = sourceAnchorForEditor(view);
            if (anchor) onScrollAnchor(anchor);
          },
          paste: (event, view) => {
            const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
              file.type.startsWith("image/"),
            );
            const selection = view.state.selection.main;
            if (files.length > 0) {
              event.preventDefault();
              void importClipboardImages(files, selection.from, selection.to);
              return true;
            }
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const edit = createSmartUrlPasteEdit(
              view.state.doc.toString(),
              selection.from,
              selection.to,
              text,
            );
            if (!edit) return false;
            event.preventDefault();
            dispatchEdit(view, edit, "input.paste");
            return true;
          },
        }),
      ],
      [
        importClipboardImages,
        onPositionChange,
        onScrollAnchor,
        performAction,
        typewriterMode,
      ],
    );

    useEffect(() => {
      if (!findRequest || !viewRef.current) return;
      viewRef.current.focus();
      openSearchPanel(viewRef.current);
    }, [findRequest]);

    useEffect(() => {
      let unlisten: (() => void) | undefined;
      let cancelled = false;
      void listen<ImageDropPayload>("image-drop", ({ payload }) => {
        const view = viewRef.current;
        if (!view) {
          void cancelImageDrop(payload.paths);
          return;
        }
        const bounds = view.dom.getBoundingClientRect();
        if (
          payload.x < bounds.left ||
          payload.x > bounds.right ||
          payload.y < bounds.top ||
          payload.y > bounds.bottom
        ) {
          void cancelImageDrop(payload.paths);
          return;
        }
        const position = view.posAtCoords({ x: payload.x, y: payload.y }, false);
        void insertImportedAssets(
          async (documentPath) => {
            const assets: ImportedAsset[] = [];
            try {
              for (const path of payload.paths) {
                assets.push(await importImageFile(documentPath, path));
              }
              return assets;
            } finally {
              await cancelImageDrop(payload.paths);
            }
          },
          position,
          position,
          () => cancelImageDrop(payload.paths),
        );
      }).then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      });
      return () => {
        cancelled = true;
        unlisten?.();
      };
    }, [insertImportedAssets]);

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
            const from = Math.min(document.selectionFrom, view.state.doc.length);
            const to = Math.min(
              Math.max(from, document.selectionTo),
              view.state.doc.length,
            );
            view.dispatch({ selection: EditorSelection.range(from, to) });
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
  },
);

function dispatchEdit(
  view: EditorView,
  edit: {
    from: number;
    to: number;
    insert: string;
    selectionFrom: number;
    selectionTo: number;
  },
  userEvent: string,
) {
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.range(edit.selectionFrom, edit.selectionTo),
    scrollIntoView: true,
    userEvent,
  });
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Bild kann nicht gelesen werden"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new Error("Bilddaten sind ungültig");
  return dataUrl.slice(separator + 1);
}

function sourceAnchorForEditor(view: EditorView): ScrollAnchor | null {
  const scrollBounds = view.scrollDOM.getBoundingClientRect();
  const contentBounds = view.contentDOM.getBoundingClientRect();
  const position = view.posAtCoords({
    x: contentBounds.left + 2,
    y: scrollBounds.top + 1,
  });
  if (position === null) return null;
  const line = view.state.doc.lineAt(position);
  const coordinates = view.coordsAtPos(line.from);
  const block = view.lineBlockAt(line.from);
  const fraction = coordinates
    ? Math.min(0.999, Math.max(0, (scrollBounds.top - coordinates.top) / block.height))
    : 0;
  return { line: line.number, fraction };
}
