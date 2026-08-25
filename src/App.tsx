import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  FilePlus,
  FileUp,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
} from "lucide-react";
import {
  authorizeDocument,
  cancelDocumentSavePath,
  chooseDocumentSavePath,
  chooseMarkdownFiles,
  chooseWorkspace,
  drainOpenPaths,
  errorMessage,
  listWorkspaceMarkdown,
  loadSession,
  readDocument,
  saveDocument,
  saveDocumentAs,
  saveSession,
} from "./api";
import { ActionDialog } from "./components/ActionDialog";
import { CodeEditor, type CodeEditorHandle } from "./components/CodeEditor";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { QuickOpen } from "./components/QuickOpen";
import { Sidebar } from "./components/Sidebar";
import { computeTextStats, extractOutline } from "./lib/markdown";
import type { QuickOpenCandidate } from "./lib/quickOpen";
import type {
  DialogSpec,
  DocumentPayload,
  DocumentState,
  FileSystemChange,
  SessionState,
  SidebarMode,
  WorkspaceFile,
} from "./types";
import { isDirty } from "./types";
import "highlight.js/styles/github.css";
import "./App.css";

interface QueuedDialog {
  spec: DialogSpec;
  resolve: (answer: string) => void;
}

const MAX_RECENT_PATHS = 30;

const newDocumentId = (): string => crypto.randomUUID();

const toDocumentState = (payload: DocumentPayload): DocumentState => ({
  id: newDocumentId(),
  path: payload.path,
  name: payload.name,
  source: payload.source,
  revision: payload.revision,
  savedSource: payload.source,
  selectionFrom: 0,
  selectionTo: 0,
  scrollTop: 0,
});

function App() {
  const [documents, setDocuments] = useState<DocumentState[]>([]);
  const [activeDocumentId, setActiveDocumentIdState] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [expandedDirectories, setExpandedDirectories] = useState(
    () => new Set<string>(),
  );
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(270);
  const [editorRatio, setEditorRatio] = useState(0.5);
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [findRequest, setFindRequest] = useState(0);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const darkMode = useDarkMode();

  const documentsRef = useRef<DocumentState[]>([]);
  const activeDocumentIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const forceCloseRef = useRef(false);
  const openingPathsRef = useRef(new Set<string>());
  const dialogQueueRef = useRef<QueuedDialog[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const changedPathsRef = useRef(new Set<string>());
  const changeTimerRef = useRef<number | null>(null);
  const editorRef = useRef<CodeEditorHandle>(null);

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

  const setActiveDocumentId = useCallback((id: string | null) => {
    activeDocumentIdRef.current = id;
    setActiveDocumentIdState(id);
  }, []);

  const touchRecent = useCallback((path: string) => {
    setRecentPaths((current) => [
      path,
      ...current.filter((candidate) => candidate !== path),
    ].slice(0, MAX_RECENT_PATHS));
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

  const activateDocument = useCallback((id: string) => {
    const document = documentsRef.current.find((item) => item.id === id);
    if (!document) return;
    setActiveDocumentId(id);
    if (document.path) touchRecent(document.path);
  }, [setActiveDocumentId, touchRecent]);

  const createDocument = useCallback(() => {
    const usedNames = new Set(documentsRef.current.map((document) => document.name));
    let number = 1;
    while (usedNames.has(`Unbenannt ${number}`)) number += 1;
    const document: DocumentState = {
      id: newDocumentId(),
      path: null,
      name: `Unbenannt ${number}`,
      source: "",
      revision: null,
      savedSource: null,
      selectionFrom: 0,
      selectionTo: 0,
      scrollTop: 0,
    };
    updateDocuments((current) => [...current, document]);
    setActiveDocumentId(document.id);
  }, [setActiveDocumentId, updateDocuments]);

  const openDocument = useCallback(
    async (requestedPath: string, needsAuthorization = false) => {
      let path = requestedPath;
      try {
        if (needsAuthorization) path = await authorizeDocument(path);
        const existing = documentsRef.current.find(
          (document) => document.path === path,
        );
        if (existing) {
          activateDocument(existing.id);
          return;
        }
        if (openingPathsRef.current.has(path)) return;
        openingPathsRef.current.add(path);
        const payload = await readDocument(path);
        const duplicate = documentsRef.current.find(
          (document) => document.path === payload.path,
        );
        if (duplicate) {
          activateDocument(duplicate.id);
          return;
        }
        const document = toDocumentState(payload);
        updateDocuments((current) => [...current, document]);
        setActiveDocumentId(document.id);
        touchRecent(payload.path);
      } catch (error) {
        setRecentPaths((current) => current.filter((item) => item !== path));
        showToast(errorMessage(error));
      } finally {
        openingPathsRef.current.delete(path);
      }
    },
    [activateDocument, setActiveDocumentId, showToast, touchRecent, updateDocuments],
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
    (id: string, payload: DocumentPayload, keepSource?: string) => {
      updateDocuments((current) =>
        current.map((document) =>
          document.id === id
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

  const saveAsById = useCallback(
    async (id: string): Promise<string | null> => {
      const document = documentsRef.current.find((item) => item.id === id);
      if (!document) return null;
      try {
        const suggestedName = document.path ? document.name : `${document.name}.md`;
        const path = await chooseDocumentSavePath(suggestedName);
        if (!path) return null;
        const duplicate = documentsRef.current.find(
          (item) => item.id !== id && item.path === path,
        );
        if (duplicate) {
          await cancelDocumentSavePath(path);
          showToast(`${duplicate.name} ist bereits geöffnet`);
          return null;
        }
        const payload = await saveDocumentAs(path, document.source);
        applyPayload(id, payload);
        touchRecent(payload.path);
        setTreeRefreshToken((value) => value + 1);
        showToast(`${payload.name} wurde gespeichert`);
        return payload.path;
      } catch (error) {
        showToast(errorMessage(error));
        return null;
      }
    },
    [applyPayload, showToast, touchRecent],
  );

  const saveById = useCallback(
    async (id: string): Promise<string | null> => {
      const document = documentsRef.current.find((item) => item.id === id);
      if (!document) return null;
      if (!document.path || !document.revision) return saveAsById(id);
      if (!isDirty(document)) return document.path;
      const sourceToSave = document.source;

      try {
        const result = await saveDocument(
          document.path,
          document.revision,
          sourceToSave,
        );
        if (result.status === "saved") {
          updateDocuments((current) =>
            current.map((item) =>
              item.id === id
                ? {
                    ...item,
                    revision: result.revision,
                    savedSource: sourceToSave,
                    missing: false,
                  }
                : item,
            ),
          );
          touchRecent(document.path);
          showToast(`${document.name} wurde gespeichert`);
          return document.path;
        }

        let external: DocumentPayload;
        try {
          external = await readDocument(document.path);
        } catch (error) {
          updateDocuments((current) =>
            current.map((item) => item.id === id ? { ...item, missing: true } : item),
          );
          showToast(errorMessage(error));
          return null;
        }

        const choice = await ask({
          title: "Speicherkonflikt",
          message: `${document.name} wurde außerhalb von Marky geändert.`,
          detail:
            "Du kannst die externe Fassung laden oder deine aktuelle Fassung bewusst darüber speichern.",
          buttons: [
            { id: "cancel", label: "Abbrechen" },
            { id: "load", label: "Extern laden" },
            { id: "overwrite", label: "Eigene Fassung speichern", emphasis: "primary" },
          ],
        });

        if (choice === "load") {
          applyPayload(id, external);
          return external.path;
        }
        if (choice !== "overwrite") return null;
        const overwrite = await saveDocument(
          document.path,
          external.revision,
          sourceToSave,
        );
        if (overwrite.status !== "saved") {
          showToast("Die Datei wurde erneut geändert. Bitte versuche es noch einmal.");
          return null;
        }
        updateDocuments((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  revision: overwrite.revision,
                  savedSource: sourceToSave,
                  missing: false,
                }
              : item,
          ),
        );
        touchRecent(document.path);
        showToast(`${document.name} wurde gespeichert`);
        return document.path;
      } catch (error) {
        showToast(errorMessage(error));
        return null;
      }
    },
    [applyPayload, ask, saveAsById, showToast, touchRecent, updateDocuments],
  );

  const ensureDocumentPath = useCallback(
    async (id: string): Promise<string | null> => {
      const document = documentsRef.current.find((item) => item.id === id);
      if (!document) return null;
      return document.path ?? saveAsById(id);
    },
    [saveAsById],
  );

  const closeDocument = useCallback(
    async (id: string) => {
      const document = documentsRef.current.find((item) => item.id === id);
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
        if (choice === "save" && !(await saveById(id))) return;
      }
      const index = documentsRef.current.findIndex((item) => item.id === id);
      const nextDocuments = documentsRef.current.filter((item) => item.id !== id);
      replaceDocuments(nextDocuments);
      if (activeDocumentIdRef.current === id) {
        const next = nextDocuments[Math.min(index, nextDocuments.length - 1)];
        setActiveDocumentId(next?.id ?? null);
      }
    },
    [ask, replaceDocuments, saveById, setActiveDocumentId],
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
      if (choice === "save" && !(await saveById(document.id))) return false;
    }
    return true;
  }, [ask, saveById]);

  const processExternalChanges = useCallback(async () => {
    const paths = [...changedPathsRef.current];
    changedPathsRef.current.clear();
    setTreeRefreshToken((value) => value + 1);
    for (const path of paths) {
      const document = documentsRef.current.find((item) => item.path === path);
      if (!document || !document.path || !document.revision) continue;
      let external: DocumentPayload;
      try {
        external = await readDocument(document.path);
      } catch {
        updateDocuments((current) =>
          current.map((item) => item.id === document.id ? { ...item, missing: true } : item),
        );
        showToast(`${document.name} ist nicht mehr verfügbar`);
        continue;
      }
      if (external.revision.hash === document.revision.hash) continue;
      if (!isDirty(document)) {
        applyPayload(document.id, external);
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
      if (choice === "load") applyPayload(document.id, external);
      if (choice === "keep") applyPayload(document.id, external, document.source);
    }
  }, [applyPayload, ask, showToast, updateDocuments]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];
    async function initialize() {
      unlisteners.push(await listen<string>("menu-action", ({ payload }) => {
        if (payload === "new-file") createDocument();
        if (payload === "open-file") void openSelectedFiles();
        if (payload === "open-folder") void openSelectedWorkspace();
        if (payload === "quick-open") setQuickOpenVisible(true);
        const activeId = activeDocumentIdRef.current;
        if (payload === "save" && activeId) void saveById(activeId);
        if (payload === "save-as" && activeId) void saveAsById(activeId);
        if (payload === "find") setFindRequest((value) => value + 1);
        if (payload === "toggle-sidebar") setSidebarCollapsed((value) => !value);
      }));
      unlisteners.push(await listen<string[]>("open-paths", ({ payload }) => {
        if (!initializedRef.current) return;
        for (const path of payload) void openDocument(path, true);
      }));
      unlisteners.push(await listen<FileSystemChange>("file-system-change", ({ payload }) => {
        payload.paths.forEach((path) => changedPathsRef.current.add(path));
        if (changeTimerRef.current) window.clearTimeout(changeTimerRef.current);
        changeTimerRef.current = window.setTimeout(
          () => void processExternalChanges(),
          300,
        );
      }));
      unlisteners.push(await getCurrentWindow().onCloseRequested(async (event) => {
        if (forceCloseRef.current) return;
        event.preventDefault();
        if (await confirmAllDirty()) {
          forceCloseRef.current = true;
          await getCurrentWindow().close();
        }
      }));

      try {
        const session = await loadSession();
        if (cancelled) return;
        setWorkspaceRoot(session.workspaceRoot);
        setRecentPaths(session.recentPaths);
        setExpandedDirectories(new Set(session.expandedDirectories));
        setSidebarMode(session.sidebarMode);
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
        const restoredActive = restored.find(
          (document) => document.path === session.activePath,
        ) ?? restored[0];
        setActiveDocumentId(restoredActive?.id ?? null);
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
    createDocument,
    openDocument,
    openSelectedFiles,
    openSelectedWorkspace,
    processExternalChanges,
    replaceDocuments,
    saveAsById,
    saveById,
    setActiveDocumentId,
    showToast,
  ]);

  useEffect(() => {
    if (!initializedRef.current) return;
    const timer = window.setTimeout(() => {
      const activeDocument = documents.find(
        (document) => document.id === activeDocumentId,
      );
      const session: SessionState = {
        workspaceRoot,
        openPaths: documents.flatMap((document) => document.path ? [document.path] : []),
        activePath: activeDocument?.path ?? null,
        recentPaths,
        expandedDirectories: [...expandedDirectories],
        sidebarMode,
        sidebarCollapsed,
        sidebarWidth,
        editorRatio,
      };
      void saveSession(session).catch((error) => showToast(errorMessage(error)));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    activeDocumentId,
    documents,
    editorRatio,
    expandedDirectories,
    recentPaths,
    showToast,
    sidebarCollapsed,
    sidebarMode,
    sidebarWidth,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!quickOpenVisible || !workspaceRoot) {
      if (!workspaceRoot) setWorkspaceFiles([]);
      return;
    }
    let cancelled = false;
    setQuickOpenLoading(true);
    void listWorkspaceMarkdown(workspaceRoot)
      .then((files) => {
        if (!cancelled) setWorkspaceFiles(files);
      })
      .catch((error) => {
        if (!cancelled) showToast(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setQuickOpenLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quickOpenVisible, showToast, treeRefreshToken, workspaceRoot]);

  const activeDocument = useMemo(
    () => documents.find((document) => document.id === activeDocumentId) ?? null,
    [activeDocumentId, documents],
  );

  const quickOpenCandidates = useMemo<QuickOpenCandidate[]>(() => {
    const byPath = new Map<string, WorkspaceFile>();
    workspaceFiles.forEach((file) => byPath.set(file.path, file));
    for (const path of recentPaths) {
      if (!byPath.has(path)) {
        byPath.set(path, {
          path,
          name: fileName(path),
          relativePath: path,
        });
      }
    }
    for (const document of documents) {
      if (document.path && !byPath.has(document.path)) {
        byPath.set(document.path, {
          path: document.path,
          name: document.name,
          relativePath: document.path,
        });
      }
    }
    const openPaths = new Set(documents.flatMap((document) => document.path ? [document.path] : []));
    const recentRanks = new Map(recentPaths.map((path, index) => [path, index]));
    return [...byPath.values()].map((file) => ({
      ...file,
      isOpen: openPaths.has(file.path),
      recentRank: recentRanks.get(file.path) ?? null,
    }));
  }, [documents, recentPaths, workspaceFiles]);

  const outline = useMemo(
    () => activeDocument ? extractOutline(activeDocument.source) : [],
    [activeDocument],
  );
  const totalStats = useMemo(
    () => computeTextStats(activeDocument?.source ?? ""),
    [activeDocument?.source],
  );
  const selectedStats = useMemo(() => {
    if (!activeDocument || activeDocument.selectionFrom === activeDocument.selectionTo) {
      return null;
    }
    return computeTextStats(
      activeDocument.source.slice(
        activeDocument.selectionFrom,
        activeDocument.selectionTo,
      ),
    );
  }, [activeDocument]);

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
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <div className="toolbar-divider" />
        <button type="button" onClick={createDocument}>
          <FilePlus size={16} />
          Neue Datei
        </button>
        <button type="button" onClick={() => void openSelectedFiles()}>
          <FileUp size={16} />
          Datei öffnen
        </button>
        <button type="button" onClick={() => void openSelectedWorkspace()}>
          <FolderOpen size={16} />
          Ordner öffnen
        </button>
        <button
          type="button"
          disabled={!activeDocument || !isDirty(activeDocument)}
          onClick={() => activeDocument && void saveById(activeDocument.id)}
        >
          <Save size={16} />
          Speichern
        </button>
        <div className="toolbar-document" title={activeDocument?.path ?? activeDocument?.name}>
          {activeDocument?.path ?? activeDocument?.name ?? "Bereit"}
        </div>
      </header>

      <main className="workspace">
        {!sidebarCollapsed && (
          <>
            <div className="sidebar-container" style={{ width: sidebarWidth }}>
              <Sidebar
                documents={documents}
                activeDocumentId={activeDocumentId}
                workspaceRoot={workspaceRoot}
                mode={sidebarMode}
                outline={outline}
                expandedDirectories={expandedDirectories}
                refreshToken={treeRefreshToken}
                onActivate={activateDocument}
                onClose={(id) => void closeDocument(id)}
                onModeChange={setSidebarMode}
                onRevealOutline={(offset) => editorRef.current?.revealOffset(offset)}
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
            <section className="editor-pane" style={{ flexBasis: `${editorRatio * 100}%` }}>
              <div className="pane-header">
                <span>MARKDOWN</span>
                {isDirty(activeDocument) && <span>Ungespeichert</span>}
              </div>
              <CodeEditor
                ref={editorRef}
                key={activeDocument.id}
                document={activeDocument}
                darkMode={darkMode}
                findRequest={findRequest}
                onChange={(source) =>
                  updateDocuments((current) =>
                    current.map((document) =>
                      document.id === activeDocument.id ? { ...document, source } : document,
                    ),
                  )
                }
                onPositionChange={(selectionFrom, selectionTo, scrollTop) => {
                  const stored = documentsRef.current.find(
                    (document) => document.id === activeDocument.id,
                  );
                  if (
                    !stored ||
                    (stored.selectionFrom === selectionFrom &&
                      stored.selectionTo === selectionTo &&
                      stored.scrollTop === scrollTop)
                  ) return;
                  updateDocuments((current) =>
                    current.map((document) =>
                      document.id === activeDocument.id
                        ? { ...document, selectionFrom, selectionTo, scrollTop }
                        : document,
                    ),
                  );
                }}
                onEnsureSaved={() => ensureDocumentPath(activeDocument.id)}
                onError={showToast}
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
            <p>Erstelle eine Markdown-Datei oder öffne einen vorhandenen Ordner.</p>
            <div>
              <button type="button" onClick={createDocument}>
                <FilePlus size={17} />
                Neue Datei
              </button>
              <button type="button" onClick={() => void openSelectedFiles()}>
                <FileUp size={17} />
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

      <footer className="status-bar">
        {activeDocument ? (
          <>
            {selectedStats && (
              <span>
                Auswahl: {formatNumber(selectedStats.words)} Wörter · {formatNumber(selectedStats.characters)} Zeichen · {formatNumber(selectedStats.lines)} Zeilen · {selectedStats.readingMinutes} Min. Lesezeit
              </span>
            )}
            <span>{formatNumber(totalStats.words)} Wörter</span>
            <span>{formatNumber(totalStats.characters)} Zeichen</span>
            <span>{formatNumber(totalStats.lines)} Zeilen</span>
            <span>{totalStats.readingMinutes} Min. Lesezeit</span>
          </>
        ) : (
          <span>Marky 0.2.0</span>
        )}
      </footer>

      <QuickOpen
        open={quickOpenVisible}
        loading={quickOpenLoading}
        candidates={quickOpenCandidates}
        onClose={() => setQuickOpenVisible(false)}
        onChoose={(path) => {
          setQuickOpenVisible(false);
          void openDocument(path);
        }}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
      <ActionDialog dialog={dialog} onAnswer={answerDialog} />
    </div>
  );
}

function fileName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

const numberFormatter = new Intl.NumberFormat("de-DE");
const formatNumber = (value: number): string => numberFormatter.format(value);

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
