import { describe, expect, it } from "vitest";
import { createMarkdownEdit, type MarkdownAction } from "./formatting";

function apply(
  source: string,
  from: number,
  to: number,
  action: MarkdownAction,
): string {
  const edit = createMarkdownEdit(source, from, to, action);
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
}

describe("Markdown-Formatierung", () => {
  it("umschließt eine Auswahl und entfernt vorhandene Marker wieder", () => {
    expect(apply("Hallo Welt", 6, 10, "bold")).toBe("Hallo **Welt**");
    expect(apply("Hallo **Welt**", 8, 12, "bold")).toBe("Hallo Welt");
    expect(apply("Hallo Welt", 6, 10, "italic")).toBe("Hallo *Welt*");
    expect(apply("Hallo Welt", 6, 10, "strike")).toBe("Hallo ~~Welt~~");
  });

  it("erstellt Listen aus mehreren markierten Zeilen", () => {
    expect(apply("Eins\nZwei", 0, 9, "bulletList")).toBe("- Eins\n- Zwei");
    expect(apply("Eins\nZwei", 0, 9, "orderedList")).toBe("1. Eins\n2. Zwei");
    expect(apply("- Eins\n- Zwei", 0, 13, "taskList")).toBe(
      "- [ ] Eins\n- [ ] Zwei",
    );
  });

  it("baut Links und Tabellen aus einer Auswahl", () => {
    expect(apply("OpenAI", 0, 6, "link")).toBe("[OpenAI](https://)");
    expect(apply("Wert", 0, 4, "table")).toContain("| Wert |  |");
  });
});
