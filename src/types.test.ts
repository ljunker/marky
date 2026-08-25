import { describe, expect, it } from "vitest";
import type { DocumentState } from "./types";
import { isDirty } from "./types";

const document: DocumentState = {
  id: "document-1",
  name: "README.md",
  path: "/tmp/README.md",
  source: "Hallo",
  savedSource: "Hallo",
  revision: { modifiedMillis: 1, size: 5, hash: "abc" },
  selectionFrom: 0,
  selectionTo: 0,
  scrollTop: 0,
};

describe("Dokumentzustand", () => {
  it("erkennt gespeicherte und ungespeicherte Inhalte", () => {
    expect(isDirty(document)).toBe(false);
    expect(isDirty({ ...document, source: "Geändert" })).toBe(true);
    expect(isDirty({ ...document, path: null, revision: null, savedSource: null })).toBe(true);
  });
});
