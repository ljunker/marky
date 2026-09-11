import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../api", () => ({ readLocalAsset: vi.fn() }));

const settings = {
  fontSize: 15,
  contentWidth: null,
  codeTheme: "system-github" as const,
  scrollSyncEnabled: true,
};

describe("MarkdownPreview", () => {
  it("öffnet angeklickte Wiki-Links innerhalb von Marky", () => {
    const onOpenWikiLink = vi.fn();
    const { container } = render(
      <MarkdownPreview
        documentPath="/workspace/Index.md"
        source="[[Kapitel/Start.md]]"
        wikiLinksEnabled
        settings={settings}
        customCss=""
        darkMode={false}
        onScrollAnchor={() => undefined}
        onOpenWikiLink={onOpenWikiLink}
      />,
    );
    const host = container.querySelector<HTMLElement>(".markdown-preview-host");
    const anchor = host?.shadowRoot?.querySelector<HTMLAnchorElement>(
      "a[data-wiki-link]",
    );

    expect(anchor).not.toBeNull();
    fireEvent.click(anchor!);
    expect(onOpenWikiLink).toHaveBeenCalledWith("Kapitel/Start.md");
  });
});
