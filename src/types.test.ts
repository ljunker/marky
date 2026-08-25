import { describe, expect, it } from "vitest";
import type { DocumentState } from "./types";
import { isDirty } from "./types";

const document: DocumentState = {
  name: "README.md",
  path: "/tmp/README.md",
  source: "Hallo",
  savedSource: "Hallo",
  revision: { modifiedMillis: 1, size: 5, hash: "abc" },
  cursor: 0,
  scrollTop: 0,
};

describe("Dokumentzustand", () => {
  it("erkennt gespeicherte und ungespeicherte Inhalte", () => {
    expect(isDirty(document)).toBe(false);
    expect(isDirty({ ...document, source: "Geändert" })).toBe(true);
  });
});
