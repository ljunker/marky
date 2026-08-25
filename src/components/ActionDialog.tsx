import type { DialogSpec } from "../types";

interface ActionDialogProps {
  dialog: DialogSpec | null;
  onAnswer: (answer: string) => void;
}

export function ActionDialog({ dialog, onAnswer }: ActionDialogProps) {
  if (!dialog) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="action-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
      >
        <h2 id="dialog-title">{dialog.title}</h2>
        <p id="dialog-message">{dialog.message}</p>
        {dialog.detail && <p className="dialog-detail">{dialog.detail}</p>}
        <div className="dialog-actions">
          {dialog.buttons.map((button) => (
            <button
              key={button.id}
              className={button.emphasis ? `button-${button.emphasis}` : undefined}
              onClick={() => onAnswer(button.id)}
              type="button"
            >
              {button.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
