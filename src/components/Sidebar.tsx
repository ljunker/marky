import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  X,
} from "lucide-react";
import { errorMessage, listDirectory } from "../api";
import type { DirectoryEntry, DocumentState } from "../types";
import { isDirty } from "../types";

interface SidebarProps {
  documents: DocumentState[];
  activePath: string | null;
  workspaceRoot: string | null;
  expandedDirectories: Set<string>;
  refreshToken: number;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onOpenMarkdown: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onError: (message: string) => void;
}

export function Sidebar({
  documents,
  activePath,
  workspaceRoot,
  expandedDirectories,
  refreshToken,
  onActivate,
  onClose,
  onOpenMarkdown,
  onToggleDirectory,
  onError,
}: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Dateien">
      <SidebarSection title="Offene Dateien" count={documents.length}>
        {documents.length === 0 ? (
          <p className="sidebar-placeholder">Noch keine Dateien geöffnet</p>
        ) : (
          <ul className="file-list">
            {documents.map((document) => (
              <li key={document.path}>
                <button
                  type="button"
                  className={`file-row ${activePath === document.path ? "active" : ""}`}
                  onClick={() => onActivate(document.path)}
                  title={document.path}
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
                      onClose(document.path);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onClose(document.path);
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
  const rootName = props.root.split("/").filter(Boolean).at(-1) ?? props.root;
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
