import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FileText,
  Files,
  Folder,
  FolderOpen,
  ListTree,
  Search,
  X,
} from "lucide-react";
import { errorMessage, listDirectory } from "../api";
import type {
  DirectoryEntry,
  DocumentState,
  OutlineItem,
  SidebarMode,
  WorkspaceSearchHit,
} from "../types";
import { isDirty } from "../types";
import { WorkspaceSearch } from "./WorkspaceSearch";

interface SidebarProps {
  documents: DocumentState[];
  activeDocumentId: string | null;
  workspaceRoot: string | null;
  mode: SidebarMode;
  outline: OutlineItem[];
  expandedDirectories: Set<string>;
  refreshToken: number;
  searchFocusRequest: number;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onModeChange: (mode: SidebarMode) => void;
  onRevealOutline: (offset: number) => void;
  onOpenMarkdown: (path: string) => void;
  onOpenSearchHit: (hit: WorkspaceSearchHit) => void;
  onToggleDirectory: (path: string) => void;
  onError: (message: string) => void;
}

export function Sidebar({
  documents,
  activeDocumentId,
  workspaceRoot,
  mode,
  outline,
  expandedDirectories,
  refreshToken,
  searchFocusRequest,
  onActivate,
  onClose,
  onModeChange,
  onRevealOutline,
  onOpenMarkdown,
  onOpenSearchHit,
  onToggleDirectory,
  onError,
}: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Dateien">
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar-Ansicht">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "files"}
          className={mode === "files" ? "active" : ""}
          onClick={() => onModeChange("files")}
        >
          <Files size={14} />
          Dateien
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "outline"}
          className={mode === "outline" ? "active" : ""}
          onClick={() => onModeChange("outline")}
        >
          <ListTree size={14} />
          Gliederung
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "search"}
          className={mode === "search" ? "active" : ""}
          onClick={() => onModeChange("search")}
        >
          <Search size={14} />
          Suche
        </button>
      </div>
      {mode === "search" ? (
        <WorkspaceSearch
          workspaceRoot={workspaceRoot}
          documents={documents}
          refreshToken={refreshToken}
          focusRequest={searchFocusRequest}
          onOpenHit={onOpenSearchHit}
          onError={onError}
        />
      ) : mode === "outline" ? (
        <div className="outline-panel" role="tabpanel">
          {outline.length === 0 ? (
            <p className="sidebar-placeholder">Keine Überschriften im Dokument</p>
          ) : (
            <ul className="outline-list">
              {outline.map((item, index) => (
                <li key={`${item.offset}-${index}`}>
                  <button
                    type="button"
                    style={{ paddingLeft: `${10 + (item.level - 1) * 13}px` }}
                    title={`Zeile ${item.line}: ${item.text}`}
                    onClick={() => onRevealOutline(item.offset)}
                  >
                    <span className="outline-level">H{item.level}</span>
                    <span>{item.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="sidebar-files" role="tabpanel">
      <SidebarSection title="Offene Dateien" count={documents.length}>
        {documents.length === 0 ? (
          <p className="sidebar-placeholder">Noch keine Dateien geöffnet</p>
        ) : (
          <ul className="file-list">
            {documents.map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  className={`file-row ${activeDocumentId === document.id ? "active" : ""}`}
                  onClick={() => onActivate(document.id)}
                  title={document.path ?? document.name}
                >
                  <FileText size={15} aria-hidden="true" />
                  <span className="file-name">{document.name}</span>
                  {document.missing ? (
                    <span className="missing-mark" title="Datei nicht verfügbar">
                      !
                    </span>
                  ) : (
                    isDirty(document) && (
                      <span className="dirty-dot" title="Ungespeichert" />
                    )
                  )}
                  <span
                    className="close-file"
                    role="button"
                    tabIndex={0}
                    aria-label={`${document.name} schließen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(document.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onClose(document.id);
                      }
                    }}
                  >
                    <X size={13} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>

      <SidebarSection title="Ordner">
        {workspaceRoot ? (
          <WorkspaceTree
            root={workspaceRoot}
            expandedDirectories={expandedDirectories}
            refreshToken={refreshToken}
            onOpenMarkdown={onOpenMarkdown}
            onToggleDirectory={onToggleDirectory}
            onError={onError}
          />
        ) : (
          <p className="sidebar-placeholder">Kein Ordner ausgewählt</p>
        )}
      </SidebarSection>
        </div>
      )}
    </aside>
  );
}

function SidebarSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="sidebar-section">
      <header>
        <span>{title}</span>
        {typeof count === "number" && <span>{count}</span>}
      </header>
      {children}
    </section>
  );
}

interface WorkspaceTreeProps {
  root: string;
  expandedDirectories: Set<string>;
  refreshToken: number;
  onOpenMarkdown: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onError: (message: string) => void;
}

function WorkspaceTree(props: WorkspaceTreeProps) {
  const pathSegments = props.root.split("/").filter(Boolean);
  const rootName = pathSegments[pathSegments.length - 1] ?? props.root;
  return (
    <div className="workspace-tree">
      <div className="tree-root" title={props.root}>
        <FolderOpen size={15} />
        <span>{rootName}</span>
      </div>
      <DirectoryChildren directory={props.root} depth={0} {...props} />
    </div>
  );
}

function DirectoryChildren({
  directory,
  depth,
  expandedDirectories,
  refreshToken,
  onOpenMarkdown,
  onToggleDirectory,
  onError,
}: WorkspaceTreeProps & { directory: string; depth: number }) {
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listDirectory(directory)
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((error) => {
        if (!cancelled) onError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [directory, onError, refreshToken]);

  if (loading && entries.length === 0) {
    return <div className="tree-loading">Laden …</div>;
  }

  return (
    <ul className="tree-list">
      {entries.map((entry) => {
        const expanded = expandedDirectories.has(entry.path);
        return (
          <li key={entry.path}>
            <button
              type="button"
              className={`tree-row kind-${entry.kind}`}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
              title={
                entry.isSymlink && entry.kind === "directory"
                  ? `${entry.path} (Verknüpfung wird nicht aufgeklappt)`
                  : entry.path
              }
              onClick={() => {
                if (entry.kind === "markdown") onOpenMarkdown(entry.path);
                if (entry.kind === "directory" && !entry.isSymlink) {
                  onToggleDirectory(entry.path);
                }
              }}
            >
              {entry.kind === "directory" ? (
                <>
                  {entry.isSymlink ? (
                    <span className="tree-chevron-placeholder" />
                  ) : expanded ? (
                    <ChevronDown size={13} />
                  ) : (
                    <ChevronRight size={13} />
                  )}
                  {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
                </>
              ) : (
                <>
                  <span className="tree-chevron-placeholder" />
                  {entry.kind === "image" ? (
                    <FileImage size={15} />
                  ) : (
                    <FileText size={15} />
                  )}
                </>
              )}
              <span>{entry.name}</span>
            </button>
            {entry.kind === "directory" && expanded && !entry.isSymlink && (
              <DirectoryChildren
                directory={entry.path}
                depth={depth + 1}
                expandedDirectories={expandedDirectories}
                refreshToken={refreshToken}
                root={entry.path}
                onOpenMarkdown={onOpenMarkdown}
                onToggleDirectory={onToggleDirectory}
                onError={onError}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
