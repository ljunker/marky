import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import { rankQuickOpen, type QuickOpenCandidate } from "../lib/quickOpen";

interface QuickOpenProps {
  open: boolean;
  loading: boolean;
  candidates: QuickOpenCandidate[];
  onChoose: (path: string) => void;
  onClose: () => void;
}

export function QuickOpen({
  open,
  loading,
  candidates,
  onChoose,
  onClose,
}: QuickOpenProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () => rankQuickOpen(candidates, query),
    [candidates, query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  return (
    <div className="quick-open-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="quick-open"
        role="dialog"
        aria-modal="true"
        aria-label="Schnell öffnen"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "ArrowDown" && results.length > 0) {
            event.preventDefault();
            setSelectedIndex((index) => (index + 1) % results.length);
          }
          if (event.key === "ArrowUp" && results.length > 0) {
            event.preventDefault();
            setSelectedIndex((index) => (index - 1 + results.length) % results.length);
          }
          if (event.key === "Enter" && results[selectedIndex]) {
            event.preventDefault();
            onChoose(results[selectedIndex].path);
          }
        }}
      >
        <div className="quick-open-input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Datei oder Pfad eingeben …"
            aria-label="Dateien durchsuchen"
            aria-controls="quick-open-results"
            aria-activedescendant={results[selectedIndex] ? `quick-open-${selectedIndex}` : undefined}
          />
          <button type="button" aria-label="Schließen" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="quick-open-hint">↑↓ auswählen · ↵ öffnen · esc schließen</div>
        <ul id="quick-open-results" role="listbox">
          {results.map((candidate, index) => (
            <li
              id={`quick-open-${index}`}
              key={candidate.path}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <button
                type="button"
                className={index === selectedIndex ? "selected" : ""}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => onChoose(candidate.path)}
              >
                <FileText size={16} aria-hidden="true" />
                <span>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.relativePath}</small>
                </span>
                {candidate.isOpen && <em>Offen</em>}
              </button>
            </li>
          ))}
        </ul>
        {loading && <p className="quick-open-empty">Dateien werden geladen …</p>}
        {!loading && results.length === 0 && (
          <p className="quick-open-empty">
            {candidates.length === 0
              ? "Öffne zuerst einen Ordner oder eine Markdown-Datei."
              : "Keine passende Markdown-Datei gefunden."}
          </p>
        )}
      </section>
    </div>
  );
}
