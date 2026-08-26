import { describe, expect, it } from "vitest";
import type { DocumentState } from "../types";
import { recoverySnapshotFor, sameRecoveryContent } from "./recovery";

const document: DocumentState = {
  id: "buffer-1",
  path: null,
  name: "Unbenannt 1",
  source: "Noch nicht gespeichert",
  savedSource: null,
  revision: null,
  selectionFrom: 4,
  selectionTo: 9,
  scrollTop: 120,
};

describe("Recovery-Snapshots", () => {
  it("sichert auch unbenannte Puffer samt Editorposition", () => {
    expect(recoverySnapshotFor(document, 42)).toEqual({
      ...document,
      updatedAtMillis: 42,
    });
  });

  it("ignoriert nur den Sicherungszeitpunkt beim Änderungsvergleich", () => {
    const first = recoverySnapshotFor(document, 1);
    const later = recoverySnapshotFor(document, 2);
    expect(sameRecoveryContent(first, later)).toBe(true);
    expect(sameRecoveryContent(first, { ...later, source: "Neu" })).toBe(false);
  });
});
