import { describe, expect, it } from "vitest";
import {
  computeTextStats,
  extractOutline,
  isRelativeAsset,
  renderMarkdown,
} from "./markdown";

describe("Markdown-Vorschau", () => {
  it("rendert GitHub-artige Blöcke", () => {
    const html = renderMarkdown(`
# Überschrift

| A | B |
| - | - |
| 1 | 2 |

- [x] Fertig

~~~rust
fn main() {}
~~~
`);

    expect(html).toContain('<h1 data-source-line="2">Überschrift</h1>');
    expect(html).toContain('<table data-source-line="4">');
    expect(html).toContain("task-list-item");
    expect(html).toContain("hljs");
    expect(html).toContain('<pre class="hljs" data-source-line="10">');
  });

  it("extrahiert Überschriften außerhalb von Codeblöcken", () => {
    const outline = extractOutline(`# Eins\n\nTitel\n=====\n\n\`\`\`md\n# Kein Eintrag\n\`\`\``);
    expect(outline.map(({ level, text, line }) => ({ level, text, line }))).toEqual([
      { level: 1, text: "Eins", line: 1 },
      { level: 1, text: "Titel", line: 3 },
    ]);
  });

  it("zählt sichtbaren Text ohne Markdown-Syntax und Code", () => {
    const stats = computeTextStats("# Hallo **Marky**\n\n```ts\nconst geheim = 1\n```");
    expect(stats.words).toBe(2);
    expect(stats.lines).toBe(5);
    expect(stats.readingMinutes).toBe(1);
  });

  it("entfernt aktive HTML-Inhalte", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">Link</a>',
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("markiert relative Bilder für die sichere Auflösung im Rust-Kern", () => {
    const html = renderMarkdown("![Lokal](images/bild.png) ![Web](https://example.com/a.png)");

    expect(html).toContain('data-local-src="images/bild.png"');
    expect(html).toContain('src="https://example.com/a.png"');
    expect(isRelativeAsset("../bild.png")).toBe(true);
    expect(isRelativeAsset("https://example.com/bild.png")).toBe(false);
    expect(isRelativeAsset("/absolut/bild.png")).toBe(false);
  });

  it("rendert Wiki-Links nur bei geöffnetem Workspace als interne Links", () => {
    const source = "Siehe [[Kapitel/Start.md]] und [[Anhang.markdown]].";
    const enabled = renderMarkdown(source, true);
    const disabled = renderMarkdown(source);

    expect(enabled).toContain(
      '<a href="#" data-wiki-link="Kapitel/Start.md">Kapitel/Start.md</a>',
    );
    expect(enabled).toContain(
      '<a href="#" data-wiki-link="Anhang.markdown">Anhang.markdown</a>',
    );
    expect(enabled).not.toContain('target="_blank"');
    expect(disabled).toContain("[[Kapitel/Start.md]]");
    expect(disabled).not.toContain("data-wiki-link");
  });

  it("wandelt Wiki-Link-Syntax in Code und für andere Dateitypen nicht um", () => {
    const html = renderMarkdown(
      "`[[Inline.md]]`\n\n```md\n[[Block.md]]\n```\n\n[[Text.txt]]",
      true,
    );

    expect(html).not.toContain("data-wiki-link");
  });
});
