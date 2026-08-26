import { useEffect, useState } from "react";
import type { AppSettings } from "../types";

interface PreviewSettingsDialogProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
  onChooseCss: () => void;
  onReloadCss: () => void;
  onRemoveCss: () => void;
}

export function PreviewSettingsDialog({
  open,
  settings,
  onClose,
  onSave,
  onChooseCss,
  onReloadCss,
  onRemoveCss,
}: PreviewSettingsDialogProps) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => {
    if (open) setDraft(settings);
  }, [open]);
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="settings-title">Vorschau-Einstellungen</h2>
        <label className="settings-field">
          <span>Schriftgröße <strong>{draft.preview.fontSize} px</strong></span>
          <input
            type="range"
            min={12}
            max={24}
            value={draft.preview.fontSize}
            onChange={(event) => setDraft({
              ...draft,
              preview: { ...draft.preview, fontSize: Number(event.target.value) },
            })}
          />
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.preview.contentWidth === null}
            onChange={(event) => setDraft({
              ...draft,
              preview: {
                ...draft.preview,
                contentWidth: event.target.checked ? null : 760,
              },
            })}
          />
          Volle Inhaltsbreite
        </label>
        <label className="settings-field">
          <span>
            Inhaltsbreite {draft.preview.contentWidth
              ? <strong>{draft.preview.contentWidth} px</strong>
              : <strong>voll</strong>}
          </span>
          <input
            type="range"
            min={520}
            max={1200}
            step={20}
            disabled={draft.preview.contentWidth === null}
            value={draft.preview.contentWidth ?? 760}
            onChange={(event) => setDraft({
              ...draft,
              preview: { ...draft.preview, contentWidth: Number(event.target.value) },
            })}
          />
        </label>
        <label className="settings-field">
          <span>Code-Theme</span>
          <select
            value={draft.preview.codeTheme}
            onChange={(event) => setDraft({
              ...draft,
              preview: {
                ...draft.preview,
                codeTheme: event.target.value as AppSettings["preview"]["codeTheme"],
              },
            })}
          >
            <option value="system-github">System / GitHub</option>
            <option value="github-dark">GitHub Dark</option>
            <option value="atom-one-dark">Atom One Dark</option>
          </select>
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.preview.scrollSyncEnabled}
            onChange={(event) => setDraft({
              ...draft,
              preview: {
                ...draft.preview,
                scrollSyncEnabled: event.target.checked,
              },
            })}
          />
          Editor und Vorschau beim Scrollen synchronisieren
        </label>
        <div className="css-settings">
          <span>Eigene CSS-Datei</span>
          <code title={settings.customCssPath ?? undefined}>
            {settings.customCssPath ?? "Keine ausgewählt"}
          </code>
          <div>
            <button type="button" onClick={onChooseCss}>Auswählen …</button>
            <button type="button" disabled={!settings.customCssPath} onClick={onReloadCss}>
              Neu laden
            </button>
            <button type="button" disabled={!settings.customCssPath} onClick={onRemoveCss}>
              Entfernen
            </button>
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Abbrechen</button>
          <button
            type="button"
            className="button-primary"
            onClick={() => onSave({
              ...draft,
              customCssPath: settings.customCssPath,
            })}
          >
            Übernehmen
          </button>
        </div>
      </section>
    </div>
  );
}
