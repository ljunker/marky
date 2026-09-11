import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Link2,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { errorMessage, searchWorkspace } from "../api";
import { createWikiLinkSearchQuery } from "../lib/wikiLinks";
import type {
  WorkspaceSearchHit,
  WorkspaceSearchResponse,
} from "../types";

interface BacklinksSidebarProps {
  workspaceRoot: string;
  targetRelativePath: string | null;
  collapsed: boolean;
  refreshToken: number;
  onToggle: () => void;
  onOpenHit: (hit: WorkspaceSearchHit) => void;
  onError: (message: string) => void;
}

const EMPTY_RESPONSE: WorkspaceSearchResponse = {
  hits: [],
  skippedLarge: 0,
  skippedInvalidUtf8: 0,
  truncated: false,
};

export function BacklinksSidebar({
  workspaceRoot,
  targetRelativePath,
  collapsed,
  refreshToken,
  onToggle,
  onOpenHit,
  onError,
}: BacklinksSidebarProps) {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<WorkspaceSearchResponse>(EMPTY_RESPONSE);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!targetRelativePath) {
      setResponse(EMPTY_RESPONSE);
      setLoading(false);
      return;
    }

    setResponse(EMPTY_RESPONSE);
    setLoading(true);
    void searchWorkspace(
      workspaceRoot,
      createWikiLinkSearchQuery(targetRelativePath),
      { caseSensitive: true, wholeWord: false },
      [],
    )
      .then((result) => {
        if (request === requestRef.current) setResponse(result);
      })
      .catch((error) => {
        if (request !== requestRef.current) return;
        setResponse(EMPTY_RESPONSE);
        onError(errorMessage(error));
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, [onError, refreshToken, targetRelativePath, workspaceRoot]);

  const groups = useMemo(() => {
    const grouped = new Map<string, WorkspaceSearchHit[]>();
    for (const hit of response.hits) {
      const group = grouped.get(hit.path) ?? [];
      group.push(hit);
      grouped.set(hit.path, group);
    }
    return [...grouped.entries()];
  }, [response.hits]);

  return (
    <aside
      className={`backlinks-sidebar${collapsed ? " collapsed" : ""}`}
      aria-label="Backlinks"
    >
      <header className="backlinks-header">
        {!collapsed && (
          <span>
            <Link2 size={14} aria-hidden="true" />
            Backlinks
            {!loading && targetRelativePath && <small>{groups.length}</small>}
          </span>
        )}
        <button
          type="button"
          aria-label={collapsed ? "Backlinks ausklappen" : "Backlinks einklappen"}
          title={collapsed ? "Backlinks ausklappen" : "Backlinks einklappen"}
          onClick={onToggle}
        >
          {collapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
        </button>
      </header>

      {!collapsed && (
        <div className="backlinks-body">
          {!targetRelativePath && (
            <p className="sidebar-placeholder">
              Speichere das aktuelle Dokument im Arbeitsordner, um Backlinks zu sehen.
            </p>
          )}
          {targetRelativePath && loading && response.hits.length === 0 && (
            <p className="sidebar-placeholder">Backlinks werden gesucht …</p>
          )}
          {targetRelativePath && !loading && response.hits.length === 0 && (
            <p className="sidebar-placeholder">Keine Backlinks</p>
          )}
          <div className="backlinks-results">
            {groups.map(([path, hits]) => (
              <section key={path}>
                <header title={path}>
                  <FileText size={14} aria-hidden="true" />
                  <span>{hits[0].relativePath}</span>
                  <em>{hits.length}</em>
                </header>
                {hits.map((hit, index) => (
                  <button
                    key={`${hit.from}-${index}`}
                    type="button"
                    title={`${hit.relativePath}:${hit.line}:${hit.column}`}
                    onClick={() => onOpenHit(hit)}
                  >
                    <span>{hit.line}</span>
                    <code>{hit.context || "(Leere Zeile)"}</code>
                  </button>
                ))}
              </section>
            ))}
          </div>
          {(response.truncated
            || response.skippedLarge > 0
            || response.skippedInvalidUtf8 > 0) && (
            <p className="search-summary">
              {response.truncated && "Trefferliste begrenzt. "}
              {response.skippedLarge > 0
                && `${response.skippedLarge} große Datei(en) übersprungen. `}
              {response.skippedInvalidUtf8 > 0
                && `${response.skippedInvalidUtf8} Nicht-UTF-8-Datei(en) übersprungen.`}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
