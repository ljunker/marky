import { describe, expect, it } from "vitest";
import {
  createImageMarkdown,
  createListContinuationEdit,
  createSmartUrlPasteEdit,
} from "./editorInput";

function apply(source: string, edit: ReturnType<typeof createListContinuationEdit>) {
  if (!edit) return source;
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
}

describe("Intelligente Editoreingaben", () => {
  it("setzt Aufzählungen, Nummern und Aufgaben fort", () => {
    expect(apply("- Eins", createListContinuationEdit("- Eins", 6, 6))).toBe("- Eins\n- ");
    expect(apply("3. Drei", createListContinuationEdit("3. Drei", 7, 7))).toBe("3. Drei\n4. ");
    expect(apply("  - [x] Fertig", createListContinuationEdit("  - [x] Fertig", 15, 15))).toBe(
      "  - [x] Fertig\n  - [ ] ",
    );
  });

  it("beendet einen leeren Listeneintrag", () => {
    expect(apply("  - ", createListContinuationEdit("  - ", 4, 4))).toBe("  ");
  });

  it("macht eine URL bei vorhandener Auswahl zum Link", () => {
    const edit = createSmartUrlPasteEdit("Marky", 0, 5, "https://example.com");
    expect(edit?.insert).toBe("[Marky](https://example.com)");
    expect(createSmartUrlPasteEdit("", 0, 0, "https://example.com")).toBeNull();
  });

  it("erstellt Markdown für mehrere importierte Bilder", () => {
    expect(createImageMarkdown([
      { relativePath: "assets/eins.png", displayName: "eins" },
      { relativePath: "assets/zwei.png", displayName: "zwei" },
    ], "Titel")).toBe("![Titel](assets/eins.png)\n![Titel](assets/zwei.png)");
  });
});
