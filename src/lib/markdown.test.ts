import { describe, expect, it } from "vitest";
import { isRelativeAsset, renderMarkdown } from "./markdown";

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

    expect(html).toContain("<h1>Überschrift</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("task-list-item");
    expect(html).toContain("hljs");
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
});
