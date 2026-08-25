import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  FilePlus2,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
} from "lucide-react";
import {
  authorizeDocument,
  chooseMarkdownFiles,
  chooseWorkspace,
  drainOpenPaths,
  errorMessage,
  loadSession,
  readDocument,
  saveDocument,
  saveSession,
} from "./api";
import { ActionDialog } from "./components/ActionDialog";
import { CodeEditor } from "./components/CodeEditor";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { Sidebar } from "./components/Sidebar";
import type {
  DialogSpec,
  DocumentState,
  FileSystemChange,
  SessionState,
} from "./types";
import { isDirty } from "./types";
import "highlight.js/styles/github.css";
import "./App.css";

interface QueuedDialog {
  spec: DialogSpec;
  resolve: (answer: string) => void;
}

const toDocumentState = (
  payload: Awaited<ReturnType<typeof readDocument>>,
): DocumentState => ({
  ...payload,
  savedSource: payload.source,
  cursor: 0,
  scrollTop: 0,
});

function App() {
  const [documents, setDocuments] = useState<DocumentState[]>([]);
  const [activePath, setActivePathState] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [expandedDirectories, setExpandedDirectories] = useState(
    () => new Set<string>(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(270);
  const [editorRatio, setEditorRatio] = useState(0.5);
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [findRequest, setFindRequest] = useState(0);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const darkMode = useDarkMode();

  const documentsRef = useRef<DocumentState[]>([]);
  const activePathRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const forceCloseRef = useRef(false);
  const openingPathsRef = useRef(new Set<string>());
  const dialogQueueRef = useRef<QueuedDialog[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const changedPathsRef = useRef(new Set<string>());
  const changeTimerRef = useRef<number | null>(null);

  const replaceDocuments = useCallback((next: DocumentState[]) => {
    documentsRef.current = next;
    setDocuments(next);
  }, []);

  const updateDocuments = useCallback(
    (updater: (current: DocumentState[]) => DocumentState[]) => {
      setDocuments((current) => {
        const next = updater(current);
        documentsRef.current = next;
        return next;
      });
    },
    [],
  );

  const setActivePath = useCallback((path: string | null) => {
    activePathRef.current = path;
    setActivePathState(path);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const ask = useCallback((spec: DialogSpec): Promise<string> => {
    return new Promise((resolve) => {
      dialogQueueRef.current.push({ spec, resolve });
      if (dialogQueueRef.current.length === 1) setDialog(spec);
    });
  }, []);

  const answerDialog = useCallback((answer: string) => {
    const current = dialogQueueRef.current.shift();
    current?.resolve(answer);
    setDialog(dialogQueueRef.current[0]?.spec ?? null);
  }, []);

  const openDocument = useCallback(
    async (requestedPath: string, needsAuthorization = false) => {
      let path = requestedPath;
      try {
        if (needsAuthorization) path = await authorizeDocument(path);
        const existing = documentsRef.current.find(
          (document) => document.path === path,
        );
        if (existing) {
          setActivePath(path);
          return;
        }
        if (openingPathsRef.current.has(path)) return;
        openingPathsRef.current.add(path);
        const payload = await readDocument(path);
        updateDocuments((current) =>
          current.some((document) => document.path === payload.path)
            ? current
            : [...current, toDocumentState(payload)],
        );
        setActivePath(payload.path);
      } catch (error) {
        showToast(errorMessage(error));
      } finally {
        openingPathsRef.current.delete(path);
      }
    },
    [setActivePath, showToast, updateDocuments],
  );

  const openSelectedFiles = useCallback(async () => {
    try {
      const paths = await chooseMarkdownFiles();
      for (const path of paths) await openDocument(path);
    } catch (error) {
      showToast(errorMessage(error));
    }
  }, [openDocument, showToast]);

  const openSelectedWorkspace = useCallback(async () => {
    try {
      const path = await chooseWorkspace();
      if (!path) return;
      setWorkspaceRoot(path);
      setExpandedDirectories(new Set());
      setTreeRefreshToken((value) => value + 1);
    } catch (error) {
      showToast(errorMessage(error));
    }
  }, [showToast]);

  const applyPayload = useCallback(
    (
      path: string,
      payload: Awaited<ReturnType<typeof readDocument>>,
      keepSource?: string,
    ) => {
      updateDocuments((current) =>
        current.map((document) =>
          document.path === path
            ? {
                ...document,
                path: payload.path,
                name: payload.name,
                source: keepSource ?? payload.source,
                savedSource: payload.source,
                revision: payload.revision,
                missing: false,
              }
            : document,
        ),
      );
    },
    [updateDocuments],
  );

  const savePath = useCallback(
    async (path: string): Promise<boolean> => {
      const document = documentsRef.current.find((item) => item.path === path);
      if (!document || !isDirty(document)) return true;
      const sourceToSave = document.source;

      try {
        const result = await saveDocument(
          path,
          document.revision,
          sourceToSave,
        );
        if (result.status === "saved") {
          updateDocuments((current) =>
            current.map((item) =>
              item.path === path
                ? {
                    ...item,
                    revision: result.revision,
                    savedSource: sourceToSave,
                    missing: false,
                  }
                : item,
            ),
          );
          showToast(`${document.name} wurde gespeichert`);
          return true;
        }

        let external;
        try {
          external = await readDocument(path);
        } catch (error) {
          updateDocuments((current) =>
            current.map((item) =>
              item.path === path ? { ...item, missing: true } : item,
            ),
          );
          showToast(errorMessage(error));
          return false;
        }

        const choice = await ask({
          title: "Speicherkonflikt",
          message: `${document.name} wurde außerhalb von Marky geändert.`,
          detail:
            "Du kannst die externe Fassung laden oder deine aktuelle Fassung bewusst darüber speichern.",
          buttons: [
            { id: "cancel", label: "Abbrechen" },
            { id: "load", label: "Extern laden" },
            {
              id: "overwrite",
              label: "Eigene Fassung speichern",
              emphasis: "primary",
            },
          ],
        });

        if (choice === "load") {
          applyPayload(path, external);
          return true;
        }
        if (choice !== "overwrite") return false;

        const overwrite = await saveDocument(
          path,
          external.revision,
          sourceToSave,
        );
        if (overwrite.status !== "saved") {
          showToast("Die Datei wurde erneut geändert. Bitte versuche es noch einmal.");
          return false;
        }
        updateDocuments((current) =>
          current.map((item) =>
            item.path === path
              ? {
                  ...item,
                  revision: overwrite.revision,
                  savedSource: sourceToSave,
                  missing: false,
                }
              : item,
          ),
        );
        showToast(`${document.name} wurde gespeichert`);
        return true;
      } catch (error) {
        showToast(errorMessage(error));
        return false;
      }
    },
    [applyPayload, ask, showToast, updateDocuments],
  );

  const closeDocument = useCallback(
    async (path: string) => {
      const snapshot = documentsRef.current;
      const document = snapshot.find((item) => item.path === path);
      if (!document) return;

      if (isDirty(document)) {
        const choice = await ask({
          title: "Ungespeicherte Änderungen",
          message: `Möchtest du die Änderungen an ${document.name} speichern?`,
          buttons: [
            { id: "cancel", label: "Abbrechen" },
            { id: "discard", label: "Verwerfen", emphasis: "danger" },
            { id: "save", label: "Speichern", emphasis: "primary" },
          ],
        });
        if (choice === "cancel") return;
        if (choice === "save" && !(await savePath(path))) return;
      }

      const index = documentsRef.current.findIndex((item) => item.path === path);
      const nextDocuments = documentsRef.current.filter(
        (item) => item.path !== path,
      );
      replaceDocuments(nextDocuments);
      if (activePathRef.current === path) {
        const next = nextDocuments[Math.min(index, nextDocuments.length - 1)];
        setActivePath(next?.path ?? null);
      }
    },
    [ask, replaceDocuments, savePath, setActivePath],
  );

  const confirmAllDirty = useCallback(async (): Promise<boolean> => {
    for (const document of documentsRef.current.filter(isDirty)) {
      const choice = await ask({
        title: "Ungespeicherte Änderungen",
        message: `Möchtest du die Änderungen an ${document.name} speichern?`,
        buttons: [
          { id: "cancel", label: "Abbrechen" },
          { id: "discard", label: "Verwerfen", emphasis: "danger" },
          { id: "save", label: "Speichern", emphasis: "primary" },
        ],
      });
      if (choice === "cancel") return false;
      if (choice === "save" && !(await savePath(document.path))) return false;
    }
    return true;
  }, [ask, savePath]);

  const processExternalChanges = useCallback(async () => {
    const paths = [...changedPathsRef.current];
    changedPathsRef.current.clear();
    setTreeRefreshToken((value) => value + 1);

    for (const path of paths) {
      const document = documentsRef.current.find((item) => item.path === path);
      if (!document) continue;

      let external;
      try {
        external = await readDocument(path);
      } catch {
        updateDocuments((current) =>
          current.map((item) =>
            item.path === path ? { ...item, missing: true } : item,
          ),
        );
        showToast(`${document.name} ist nicht mehr verfügbar`);
        continue;
      }
      if (external.revision.hash === document.revision.hash) continue;

      if (!isDirty(document)) {
        applyPayload(path, external);
        showToast(`${document.name} wurde extern aktualisiert`);
        continue;
      }

      const choice = await ask({
        title: "Datei extern geändert",
        message: `${document.name} wurde außerhalb von Marky geändert.`,
        detail: "Welche Fassung möchtest du weiter bearbeiten?",
        buttons: [
          { id: "cancel", label: "Abbrechen" },
          { id: "keep", label: "Eigene Fassung behalten" },
          { id: "load", label: "Extern laden", emphasis: "primary" },
        ],
      });
      if (choice === "load") applyPayload(path, external);
      if (choice === "keep") applyPayload(path, external, document.source);
    }
  }, [applyPayload, ask, showToast, updateDocuments]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    async function initialize() {
      unlisteners.push(
        await listen<string>("menu-action", ({ payload }) => {
          if (payload === "open-file") void openSelectedFiles();
          if (payload === "open-folder") void openSelectedWorkspace();
          if (payload === "save" && activePathRef.current) {
            void savePath(activePathRef.current);
          }
          if (payload === "find") setFindRequest((value) => value + 1);
          if (payload === "toggle-sidebar") {
            setSidebarCollapsed((value) => !value);
          }
        }),
      );
      unlisteners.push(
        await listen<string[]>("open-paths", ({ payload }) => {
          if (!initializedRef.current) return;
          for (const path of payload) void openDocument(path, true);
        }),
      );
      unlisteners.push(
        await listen<FileSystemChange>("file-system-change", ({ payload }) => {
          payload.paths.forEach((path) => changedPathsRef.current.add(path));
          if (changeTimerRef.current) window.clearTimeout(changeTimerRef.current);
          changeTimerRef.current = window.setTimeout(
            () => void processExternalChanges(),
            300,
          );
        }),
      );
      unlisteners.push(
        await getCurrentWindow().onCloseRequested(async (event) => {
          if (forceCloseRef.current) return;
          event.preventDefault();
          if (await confirmAllDirty()) {
            forceCloseRef.current = true;
            await getCurrentWindow().close();
          }
        }),
      );

      try {
        const session = await loadSession();
        if (cancelled) return;
        setWorkspaceRoot(session.workspaceRoot);
        setExpandedDirectories(new Set(session.expandedDirectories));
        setSidebarCollapsed(session.sidebarCollapsed);
        setSidebarWidth(session.sidebarWidth);
        setEditorRatio(session.editorRatio);

        const restored: DocumentState[] = [];
        for (const path of session.openPaths) {
          try {
            restored.push(toDocumentState(await readDocument(path)));
          } catch {
            // Missing and invalid documents were already removed from the session.
          }
        }
        replaceDocuments(restored);
        const restoredActive = restored.some(
          (document) => document.path === session.activePath,
        )
          ? session.activePath
          : (restored[0]?.path ?? null);
        setActivePath(restoredActive);
      } catch (error) {
        showToast(errorMessage(error));
      }

      initializedRef.current = true;
      try {
        const queued = await drainOpenPaths();
        for (const path of queued) await openDocument(path);
      } catch (error) {
        showToast(errorMessage(error));
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
      if (changeTimerRef.current) window.clearTimeout(changeTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [
    confirmAllDirty,
    openDocument,
    openSelectedFiles,
    openSelectedWorkspace,
    processExternalChanges,
    replaceDocuments,
    savePath,
    setActivePath,
    showToast,
  ]);

  useEffect(() => {
    if (!initializedRef.current) return;
    const timer = window.setTimeout(() => {
      const session: SessionState = {
        workspaceRoot,
        openPaths: documents.map((document) => document.path),
        activePath,
        expandedDirectories: [...expandedDirectories],
        sidebarCollapsed,
        sidebarWidth,
        editorRatio,
      };
      void saveSession(session).catch((error) => showToast(errorMessage(error)));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    activePath,
    documents,
    editorRatio,
    expandedDirectories,
    showToast,
    sidebarCollapsed,
    sidebarWidth,
    workspaceRoot,
  ]);

  const activeDocument = useMemo(
    () => documents.find((document) => document.path === activePath) ?? null,
    [activePath, documents],
  );

  useEffect(() => {
    const title = activeDocument
      ? `${isDirty(activeDocument) ? "● " : ""}${activeDocument.name} — Marky`
      : "Marky";
    void getCurrentWindow().setTitle(title);
  }, [activeDocument]);

  const startSidebarResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const origin = event.clientX;
    const originalWidth = sidebarWidth;
    const move = (moveEvent: PointerEvent) =>
      setSidebarWidth(
        Math.min(480, Math.max(210, originalWidth + moveEvent.clientX - origin)),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const contentRef = useRef<HTMLDivElement>(null);
  const startEditorResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const move = (moveEvent: PointerEvent) => {
      const bounds = contentRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const ratio = (moveEvent.clientX - bounds.left) / bounds.width;
      setEditorRatio(Math.min(0.75, Math.max(0.25, ratio)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <div className="app-shell">
      <header className="toolbar">
        <button
          type="button"
          className="icon-button"
          aria-label={sidebarCollapsed ? "Sidebar zeigen" : "Sidebar ausblenden"}
          title={sidebarCollapsed ? "Sidebar zeigen" : "Sidebar ausblenden"}
          onClick={() => setSidebarCollapsed((value) => !value)}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
        <div className="toolbar-divider" />
        <button type="button" onClick={() => void openSelectedFiles()}>
          <FilePlus2 size={16} />
          Datei öffnen
        </button>
        <button type="button" onClick={() => void openSelectedWorkspace()}>
          <FolderOpen size={16} />
          Ordner öffnen
        </button>
        <button
          type="button"
          disabled={!activeDocument || !isDirty(activeDocument)}
          onClick={() => activeDocument && void savePath(activeDocument.path)}
        >
          <Save size={16} />
          Speichern
        </button>
        <div className="toolbar-document" title={activeDocument?.path}>
          {activeDocument?.path ?? "Bereit"}
        </div>
      </header>

      <main className="workspace">
        {!sidebarCollapsed && (
          <>
            <div className="sidebar-container" style={{ width: sidebarWidth }}>
              <Sidebar
                documents={documents}
                activePath={activePath}
                workspaceRoot={workspaceRoot}
                expandedDirectories={expandedDirectories}
                refreshToken={treeRefreshToken}
                onActivate={setActivePath}
                onClose={(path) => void closeDocument(path)}
                onOpenMarkdown={(path) => void openDocument(path)}
                onToggleDirectory={(path) =>
                  setExpandedDirectories((current) => {
                    const next = new Set(current);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
                onError={showToast}
              />
            </div>
            <div
              className="resize-handle vertical"
              role="separator"
              aria-label="Sidebar-Größe ändern"
              onPointerDown={startSidebarResize}
            />
          </>
        )}

        {activeDocument ? (
          <div ref={contentRef} className="content-split">
            <section
              className="editor-pane"
              style={{ flexBasis: `${editorRatio * 100}%` }}
            >
              <div className="pane-header">
                <span>MARKDOWN</span>
                {isDirty(activeDocument) && <span>Ungespeichert</span>}
              </div>
              <CodeEditor
                key={activeDocument.path}
                document={activeDocument}
                darkMode={darkMode}
                findRequest={findRequest}
                onChange={(source) =>
                  updateDocuments((current) =>
                    current.map((document) =>
                      document.path === activeDocument.path
                        ? { ...document, source }
                        : document,
                    ),
                  )
                }
                onPositionChange={(cursor, scrollTop) => {
                  const stored = documentsRef.current.find(
                    (document) => document.path === activeDocument.path,
                  );
                  if (!stored || (stored.cursor === cursor && stored.scrollTop === scrollTop)) {
                    return;
                  }
                  updateDocuments((current) =>
                    current.map((document) =>
                      document.path === activeDocument.path
                        ? { ...document, cursor, scrollTop }
                        : document,
                    ),
                  );
                }}
              />
            </section>
            <div
              className="resize-handle vertical"
              role="separator"
              aria-label="Editor- und Vorschaugröße ändern"
              onPointerDown={startEditorResize}
            />
            <section className="preview-pane">
              <div className="pane-header">
                <span>VORSCHAU</span>
                <span>Live</span>
              </div>
              <MarkdownPreview
                documentPath={activeDocument.path}
                source={activeDocument.source}
              />
            </section>
          </div>
        ) : (
          <section className="empty-state">
            <div className="empty-mark">M↓</div>
            <h1>Willkommen bei Marky</h1>
            <p>Öffne eine Markdown-Datei oder wähle einen Ordner aus.</p>
            <div>
              <button type="button" onClick={() => void openSelectedFiles()}>
                <FilePlus2 size={17} />
                Datei öffnen
              </button>
              <button type="button" onClick={() => void openSelectedWorkspace()}>
                <FolderOpen size={17} />
                Ordner öffnen
              </button>
            </div>
          </section>
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <ActionDialog dialog={dialog} onAnswer={answerDialog} />
    </div>
  );
}

function useDarkMode(): boolean {
  const [darkMode, setDarkMode] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDarkMode(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return darkMode;
}

export default App;
