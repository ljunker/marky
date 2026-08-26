import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  FilePlus,
  FileUp,
  FolderOpen,
  Focus,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Settings,
  TextCursorInput,
} from "lucide-react";
import {
  authorizeDocument,
  cancelDocumentSavePath,
  chooseDocumentSavePath,
  chooseMarkdownFiles,
  chooseWorkspace,
  choosePreviewCss,
  deleteRecoverySnapshot,
  drainOpenPaths,
  errorMessage,
  listWorkspaceMarkdown,
  loadRecovery,
  loadSession,
  loadSettings,
  readDocument,
  readPreviewCss,
  saveDocument,
  saveDocumentAs,
  saveRecoverySnapshot,
  saveSession,
  saveSettings,
} from "./api";
import { ActionDialog } from "./components/ActionDialog";
import { CodeEditor, type CodeEditorHandle } from "./components/CodeEditor";
import { ConflictResolver } from "./components/ConflictResolver";
import {
  MarkdownPreview,
  type MarkdownPreviewHandle,
} from "./components/MarkdownPreview";
import { PreviewSettingsDialog } from "./components/PreviewSettingsDialog";
import { QuickOpen } from "./components/QuickOpen";
import { Sidebar } from "./components/Sidebar";
import { computeTextStats, extractOutline } from "./lib/markdown";
import type { QuickOpenCandidate } from "./lib/quickOpen";
import { recoverySnapshotFor, sameRecoveryContent } from "./lib/recovery";
import type {
  DialogSpec,
  AppSettings,
  DocumentPayload,
  DocumentState,
  FileSystemChange,
  RecoverySnapshot,
  ScrollAnchor,
  SessionState,
  SidebarMode,
  WorkspaceFile,
  WorkspaceSearchHit,
} from "./types";
import { isDirty } from "./types";
import "./App.css";

interface QueuedDialog {
  spec: DialogSpec;
  resolve: (answer: string) => void;
}

interface ConflictState {
  documentId: string;
  name: string;
  external: DocumentPayload;
  ownSource: string;
  notice?: string;
  resolve: (result: ConflictResolution) => void;
}

type ConflictResolution =
  | { action: "cancel" }
  | { action: "load"; external: DocumentPayload }
  | { action: "merge"; external: DocumentPayload; source: string };

const MAX_RECENT_PATHS = 30;
const DEFAULT_SETTINGS: AppSettings = {
  preview: {
    fontSize: 15,
    contentWidth: null,
    codeTheme: "system-github",
    scrollSyncEnabled: true,
  },
  customCssPath: null,
};

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
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [customCss, setCustomCss] = useState("");
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
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
  const previewRef = useRef<MarkdownPreviewHandle>(null);
  const settingsRef = useRef(appSettings);
  const recoveryTimersRef = useRef(new Map<string, number>());
  const recoveryStateRef = useRef(new Map<string, RecoverySnapshot>());
  const scrollLockRef = useRef({ editorUntil: 0, previewUntil: 0 });
  const pendingRevealRef = useRef<{ id: string; from: number; to: number } | null>(null);

  useEffect(() => {
    settingsRef.current = appSettings;
  }, [appSettings]);

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

  const resolveDocumentConflict = useCallback((
    document: DocumentState,
    external: DocumentPayload,
  ): Promise<ConflictResolution> => new Promise((resolve) => {
    setConflict({
      documentId: document.id,
      name: document.name,
      external,
      ownSource: document.source,
      resolve,
    });
  }), []);

  const finishConflict = useCallback((result: ConflictResolution) => {
    setConflict((current) => {
      if (current && result.action === "cancel") {
        const document = documentsRef.current.find(
          (item) => item.id === current.documentId,
        );
        if (document && isDirty(document)) {
          const snapshot = recoverySnapshotFor(document, Date.now());
          void saveRecoverySnapshot(snapshot)
            .then(() => recoveryStateRef.current.set(document.id, snapshot))
            .catch((error) => showToast(errorMessage(error)));
        }
      }
      current?.resolve(result);
      return null;
    });
  }, [showToast]);

  const acceptConflict = useCallback(async () => {
    const current = conflict;
    if (!current) return;
    try {
      const latest = await readDocument(current.external.path);
      if (latest.revision.hash !== current.external.revision.hash) {
        setConflict((value) => value ? {
          ...value,
          external: latest,
          notice: "Die externe Datei wurde erneut geändert. Der Vergleich wurde aktualisiert.",
        } : null);
        return;
      }
      finishConflict({
        action: "merge",
        external: latest,
        source: current.ownSource,
      });
    } catch (error) {
      showToast(errorMessage(error));
    }
  }, [conflict, finishConflict, showToast]);

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
    async (requestedPath: string, needsAuthorization = false): Promise<string | null> => {
      let path = requestedPath;
      try {
        if (needsAuthorization) path = await authorizeDocument(path);
        const existing = documentsRef.current.find(
          (document) => document.path === path,
        );
        if (existing) {
          activateDocument(existing.id);
          return existing.id;
        }
        if (openingPathsRef.current.has(path)) return null;
        openingPathsRef.current.add(path);
        const payload = await readDocument(path);
        const duplicate = documentsRef.current.find(
          (document) => document.path === payload.path,
        );
        if (duplicate) {
          activateDocument(duplicate.id);
          return duplicate.id;
        }
        const document = toDocumentState(payload);
        updateDocuments((current) => [...current, document]);
        setActiveDocumentId(document.id);
        touchRecent(payload.path);
        return document.id;
      } catch (error) {
        setRecentPaths((current) => current.filter((item) => item !== path));
        showToast(errorMessage(error));
        return null;
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
      if (keepSource === undefined) {
        recoveryStateRef.current.delete(id);
        void deleteRecoverySnapshot(id);
      }
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
                recovered: false,
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
        const suggestedName = document.path || /\.(?:md|markdown)$/i.test(document.name)
          ? document.name
          : `${document.name}.md`;
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
                    recovered: false,
                  }
                : item,
            ),
          );
          recoveryStateRef.current.delete(id);
          void deleteRecoverySnapshot(id);
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

        let candidateSource = sourceToSave;
        for (;;) {
          const resolution = await resolveDocumentConflict(
            { ...document, source: candidateSource },
            external,
          );
          if (resolution.action === "cancel") return null;
          if (resolution.action === "load") {
            applyPayload(id, resolution.external);
            return resolution.external.path;
          }
          candidateSource = resolution.source;
          const overwrite = await saveDocument(
            document.path,
            resolution.external.revision,
            candidateSource,
          );
          if (overwrite.status === "saved") {
            updateDocuments((current) =>
              current.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      source: candidateSource,
                      revision: overwrite.revision,
                      savedSource: candidateSource,
                      missing: false,
                      recovered: false,
                    }
                  : item,
              ),
            );
            recoveryStateRef.current.delete(id);
            void deleteRecoverySnapshot(id);
            touchRecent(document.path);
            showToast(`${document.name} wurde gespeichert`);
            return document.path;
          }
          external = await readDocument(document.path);
        }
      } catch (error) {
        showToast(errorMessage(error));
        return null;
      }
    },
    [
      applyPayload,
      resolveDocumentConflict,
      saveAsById,
      showToast,
      touchRecent,
      updateDocuments,
    ],
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
      try {
        await deleteRecoverySnapshot(id);
      } catch (error) {
        showToast(errorMessage(error));
      }
      const index = documentsRef.current.findIndex((item) => item.id === id);
      const nextDocuments = documentsRef.current.filter((item) => item.id !== id);
      replaceDocuments(nextDocuments);
      if (activeDocumentIdRef.current === id) {
        const next = nextDocuments[Math.min(index, nextDocuments.length - 1)];
        setActiveDocumentId(next?.id ?? null);
      }
    },
    [ask, replaceDocuments, saveById, setActiveDocumentId, showToast],
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
      try {
        await deleteRecoverySnapshot(document.id);
      } catch (error) {
        showToast(errorMessage(error));
        return false;
      }
    }
    return true;
  }, [ask, saveById, showToast]);

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
      const resolution = await resolveDocumentConflict(document, external);
      if (resolution.action === "load") {
        applyPayload(document.id, resolution.external);
      }
      if (resolution.action === "merge") {
        applyPayload(document.id, resolution.external, resolution.source);
      }
    }
  }, [applyPayload, resolveDocumentConflict, showToast, updateDocuments]);

  const persistAppSettings = useCallback(async (next: AppSettings) => {
    try {
      const cleaned = await saveSettings(next);
      settingsRef.current = cleaned;
      setAppSettings(cleaned);
    } catch (error) {
      showToast(errorMessage(error));
    }
  }, [showToast]);

  const selectCustomCss = useCallback(async () => {
    try {
      const payload = await choosePreviewCss();
      if (!payload) return;
      setCustomCss(payload.source);
      await persistAppSettings({
        ...settingsRef.current,
        customCssPath: payload.path,
      });
    } catch (error) {
      showToast(errorMessage(error));
    }
  }, [persistAppSettings, showToast]);

  const reloadCustomCss = useCallback(async () => {
    const path = settingsRef.current.customCssPath;
    if (!path) return;
    try {
      setCustomCss((await readPreviewCss(path)).source);
      showToast("Vorschau-CSS wurde neu geladen");
    } catch (error) {
      showToast(errorMessage(error));
    }
  }, [showToast]);

  const removeCustomCss = useCallback(() => {
    setCustomCss("");
    void persistAppSettings({ ...settingsRef.current, customCssPath: null });
  }, [persistAppSettings]);

  const openSearchHit = useCallback(async (hit: WorkspaceSearchHit) => {
    const id = await openDocument(hit.path);
    if (!id) return;
    pendingRevealRef.current = { id, from: hit.from, to: hit.to };
    setActiveDocumentId(id);
  }, [openDocument, setActiveDocumentId]);

  const syncPreviewFromEditor = useCallback((anchor: ScrollAnchor) => {
    if (!settingsRef.current.preview.scrollSyncEnabled) return;
    const now = performance.now();
    if (now < scrollLockRef.current.editorUntil) return;
    scrollLockRef.current.previewUntil = now + 120;
    previewRef.current?.scrollToSource(anchor);
  }, []);

  const syncEditorFromPreview = useCallback((anchor: ScrollAnchor) => {
    if (!settingsRef.current.preview.scrollSyncEnabled) return;
    const now = performance.now();
    if (now < scrollLockRef.current.previewUntil) return;
    scrollLockRef.current.editorUntil = now + 120;
    editorRef.current?.scrollToSource(anchor);
  }, []);

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
        if (payload === "workspace-search") {
          setFocusMode(false);
          setSidebarCollapsed(false);
          setSidebarMode("search");
          setSearchFocusRequest((value) => value + 1);
        }
        if (payload === "toggle-focus") setFocusMode((value) => !value);
        if (payload === "toggle-typewriter") setTypewriterMode((value) => !value);
        if (payload === "settings") setSettingsVisible(true);
      }));
      unlisteners.push(await listen<string[]>("open-paths", ({ payload }) => {
        if (!initializedRef.current) return;
        for (const path of payload) void openDocument(path, true);
      }));
      unlisteners.push(await listen<FileSystemChange>("file-system-change", ({ payload }) => {
        const cssPath = settingsRef.current.customCssPath;
        if (cssPath && payload.paths.includes(cssPath)) {
          void readPreviewCss(cssPath)
            .then((css) => setCustomCss(css.source))
            .catch((error) => showToast(errorMessage(error)));
        }
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
        const [settings, recovery] = await Promise.all([
          loadSettings(),
          loadRecovery(),
        ]);
        if (cancelled) return;
        settingsRef.current = settings;
        setAppSettings(settings);
        if (settings.customCssPath) {
          try {
            setCustomCss((await readPreviewCss(settings.customCssPath)).source);
          } catch (error) {
            showToast(errorMessage(error));
          }
        }
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
        const recoveredPaths = new Set(
          recovery.flatMap((snapshot) => snapshot.path ? [snapshot.path] : []),
        );
        const recoveredDocuments = recovery.map((snapshot): DocumentState => ({
          id: snapshot.id,
          path: snapshot.path,
          name: snapshot.name,
          source: snapshot.source,
          revision: snapshot.revision,
          savedSource: snapshot.savedSource,
          selectionFrom: snapshot.selectionFrom,
          selectionTo: snapshot.selectionTo,
          scrollTop: snapshot.scrollTop,
          recovered: true,
        }));
        recoveryStateRef.current = new Map(
          recovery.map((snapshot) => [snapshot.id, snapshot]),
        );
        const allRestored = [
          ...restored.filter((document) =>
            !document.path || !recoveredPaths.has(document.path)),
          ...recoveredDocuments,
        ];
        replaceDocuments(allRestored);
        const restoredActive = allRestored.find(
          (document) => document.path === session.activePath,
        )
          ?? recoveredDocuments[0]
          ?? allRestored[0];
        setActiveDocumentId(restoredActive?.id ?? null);
        if (recoveredDocuments.length > 0) {
          showToast(
            `${recoveredDocuments.length} ungespeicherte${recoveredDocuments.length === 1 ? "s Dokument" : " Dokumente"} wiederhergestellt`,
          );
        }
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
    if (!initializedRef.current) return;
    const presentIds = new Set(documents.map((document) => document.id));
    for (const [id, timer] of recoveryTimersRef.current) {
      if (!presentIds.has(id)) {
        window.clearTimeout(timer);
        recoveryTimersRef.current.delete(id);
        recoveryStateRef.current.delete(id);
      }
    }

    for (const document of documents) {
      const existingTimer = recoveryTimersRef.current.get(document.id);
      if (!isDirty(document)) {
        if (existingTimer) window.clearTimeout(existingTimer);
        recoveryTimersRef.current.delete(document.id);
        if (recoveryStateRef.current.delete(document.id)) {
          void deleteRecoverySnapshot(document.id);
        }
        continue;
      }
      const snapshot = recoverySnapshotFor(document, Date.now());
      const previous = recoveryStateRef.current.get(document.id);
      if (previous && sameRecoveryContent(previous, snapshot)) continue;
      if (existingTimer) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        recoveryTimersRef.current.delete(document.id);
        void saveRecoverySnapshot(snapshot)
          .then(() => recoveryStateRef.current.set(document.id, snapshot))
          .catch((error) => showToast(errorMessage(error)));
      }, 1000);
      recoveryTimersRef.current.set(document.id, timer);
    }
  }, [documents, showToast]);

  useEffect(() => () => {
    recoveryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!conflict) return;
    const document = documentsRef.current.find(
      (item) => item.id === conflict.documentId,
    );
    if (!document) return;
    const timer = window.setTimeout(() => {
      const snapshot = recoverySnapshotFor(
        { ...document, source: conflict.ownSource },
        Date.now(),
      );
      void saveRecoverySnapshot(snapshot)
        .then(() => recoveryStateRef.current.set(document.id, snapshot))
        .catch((error) => showToast(errorMessage(error)));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [conflict, showToast]);

  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);

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

  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending || pending.id !== activeDocumentId) return;
    const frame = window.requestAnimationFrame(() => {
      if (pendingRevealRef.current !== pending) return;
      editorRef.current?.revealRange(pending.from, pending.to);
      pendingRevealRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDocumentId, activeDocument?.source]);

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
    <div className={`app-shell${focusMode ? " focus-mode" : ""}${typewriterMode ? " typewriter-mode" : ""}`}>
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
        <button
          type="button"
          className={focusMode ? "mode-active" : ""}
          title="Fokusmodus (⇧⌘↵)"
          onClick={() => setFocusMode((value) => !value)}
        >
          <Focus size={16} />
          Fokus
        </button>
        <button
          type="button"
          className={typewriterMode ? "mode-active" : ""}
          title="Schreibmaschinenmodus (⌥⌘T)"
          onClick={() => setTypewriterMode((value) => !value)}
        >
          <TextCursorInput size={16} />
          Schreibmaschine
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Vorschau-Einstellungen"
          title="Vorschau-Einstellungen (⌘,)"
          onClick={() => setSettingsVisible(true)}
        >
          <Settings size={16} />
        </button>
        <div className="toolbar-document" title={activeDocument?.path ?? activeDocument?.name}>
          {activeDocument?.path ?? activeDocument?.name ?? "Bereit"}
        </div>
      </header>

      <main className="workspace">
        {!sidebarCollapsed && !focusMode && (
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
                searchFocusRequest={searchFocusRequest}
                onActivate={activateDocument}
                onClose={(id) => void closeDocument(id)}
                onModeChange={setSidebarMode}
                onRevealOutline={(offset) => editorRef.current?.revealOffset(offset)}
                onOpenMarkdown={(path) => void openDocument(path)}
                onOpenSearchHit={(hit) => void openSearchHit(hit)}
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
                <span>
                  {activeDocument.recovered && "Wiederhergestellt · "}
                  {isDirty(activeDocument) && "Ungespeichert"}
                </span>
              </div>
              <CodeEditor
                ref={editorRef}
                key={activeDocument.id}
                document={activeDocument}
                darkMode={darkMode}
                findRequest={findRequest}
                typewriterMode={typewriterMode}
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
                onScrollAnchor={syncPreviewFromEditor}
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
                <button
                  type="button"
                  className={appSettings.preview.scrollSyncEnabled ? "active" : ""}
                  aria-pressed={appSettings.preview.scrollSyncEnabled}
                  title="Scroll-Synchronisierung"
                  onClick={() => void persistAppSettings({
                    ...appSettings,
                    preview: {
                      ...appSettings.preview,
                      scrollSyncEnabled: !appSettings.preview.scrollSyncEnabled,
                    },
                  })}
                >
                  Sync {appSettings.preview.scrollSyncEnabled ? "an" : "aus"}
                </button>
              </div>
              <MarkdownPreview
                ref={previewRef}
                documentPath={activeDocument.path}
                source={activeDocument.source}
                settings={appSettings.preview}
                customCss={customCss}
                darkMode={darkMode}
                onScrollAnchor={syncEditorFromPreview}
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
          <span>Marky 0.3.0</span>
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
      <PreviewSettingsDialog
        open={settingsVisible}
        settings={appSettings}
        onClose={() => setSettingsVisible(false)}
        onSave={(settings) => {
          setSettingsVisible(false);
          void persistAppSettings(settings);
        }}
        onChooseCss={() => void selectCustomCss()}
        onReloadCss={() => void reloadCustomCss()}
        onRemoveCss={removeCustomCss}
      />
      {conflict && (
        <ConflictResolver
          name={conflict.name}
          externalSource={conflict.external.source}
          ownSource={conflict.ownSource}
          darkMode={darkMode}
          notice={conflict.notice}
          onOwnSourceChange={(source) => setConflict((current) =>
            current ? { ...current, ownSource: source } : null)}
          onCancel={() => finishConflict({ action: "cancel" })}
          onLoadExternal={() => finishConflict({
            action: "load",
            external: conflict.external,
          })}
          onAccept={() => void acceptConflict()}
        />
      )}
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
