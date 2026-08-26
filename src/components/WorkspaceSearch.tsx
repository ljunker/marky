import { useEffect, useMemo, useRef, useState } from "react";
import { CaseSensitive, Search, WholeWord } from "lucide-react";
import { errorMessage, searchWorkspace } from "../api";
import type {
  DocumentState,
  WorkspaceSearchHit,
  WorkspaceSearchResponse,
} from "../types";
import { isDirty } from "../types";

interface WorkspaceSearchProps {
  workspaceRoot: string | null;
  documents: DocumentState[];
  refreshToken: number;
  focusRequest: number;
  onOpenHit: (hit: WorkspaceSearchHit) => void;
  onError: (message: string) => void;
}

export function WorkspaceSearch({
  workspaceRoot,
  documents,
  refreshToken,
  focusRequest,
  onOpenHit,
  onError,
}: WorkspaceSearchProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<WorkspaceSearchResponse>({
    hits: [],
    skippedLarge: 0,
    skippedInvalidUtf8: 0,
    truncated: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (focusRequest) requestAnimationFrame(() => inputRef.current?.focus());
  }, [focusRequest]);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!workspaceRoot || !query) {
      setResponse({ hits: [], skippedLarge: 0, skippedInvalidUtf8: 0, truncated: false });
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      const overrides = documents.flatMap((document) =>
        document.path && document.path.startsWith(`${workspaceRoot}/`) && isDirty(document)
          ? [{ path: document.path, source: document.source }]
          : [],
      );
      void searchWorkspace(
        workspaceRoot,
        query,
        { caseSensitive, wholeWord },
        overrides,
      )
        .then((result) => {
          if (request === requestRef.current) setResponse(result);
        })
        .catch((error) => {
          if (request === requestRef.current) onError(errorMessage(error));
        })
        .finally(() => {
          if (request === requestRef.current) setLoading(false);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [
    caseSensitive,
    documents,
    onError,
    query,
    refreshToken,
    wholeWord,
    workspaceRoot,
  ]);

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
    <div className="workspace-search" role="tabpanel">
      <div className="workspace-search-controls">
        <div>
          <Search size={14} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Im Ordner suchen …"
            aria-label="Im Arbeitsordner suchen"
          />
        </div>
        <button
          type="button"
          className={caseSensitive ? "active" : ""}
          aria-pressed={caseSensitive}
          title="Groß-/Kleinschreibung beachten"
          onClick={() => setCaseSensitive((value) => !value)}
        >
          <CaseSensitive size={15} />
        </button>
        <button
          type="button"
          className={wholeWord ? "active" : ""}
          aria-pressed={wholeWord}
          title="Nur ganze Wörter"
          onClick={() => setWholeWord((value) => !value)}
        >
          <WholeWord size={15} />
        </button>
      </div>
      {!workspaceRoot && (
        <p className="sidebar-placeholder">Öffne zuerst einen Arbeitsordner.</p>
      )}
      {workspaceRoot && !query && (
        <p className="sidebar-placeholder">Suche literal in allen Markdown-Dateien.</p>
      )}
      {workspaceRoot && query && loading && response.hits.length === 0 && (
        <p className="sidebar-placeholder">Suche läuft …</p>
      )}
      {workspaceRoot && query && !loading && response.hits.length === 0 && (
        <p className="sidebar-placeholder">Keine Treffer</p>
      )}
      <div className="search-results">
        {groups.map(([path, hits]) => (
          <section key={path}>
            <header title={path}>
              <span>{hits[0].name}</span>
              <small>{hits[0].relativePath}</small>
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
      {(response.truncated || response.skippedLarge > 0 || response.skippedInvalidUtf8 > 0) && (
        <p className="search-summary">
          {response.truncated && "Trefferliste begrenzt. "}
          {response.skippedLarge > 0 && `${response.skippedLarge} große Datei(en) übersprungen. `}
          {response.skippedInvalidUtf8 > 0 && `${response.skippedInvalidUtf8} Nicht-UTF-8-Datei(en) übersprungen.`}
        </p>
      )}
    </div>
  );
}
