import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BacklinksSidebar } from "./BacklinksSidebar";

const mocks = vi.hoisted(() => ({
  searchWorkspace: vi.fn(),
}));

vi.mock("../api", () => ({
  errorMessage: (error: unknown) => String(error),
  searchWorkspace: mocks.searchWorkspace,
}));

describe("BacklinksSidebar", () => {
  beforeEach(() => {
    mocks.searchWorkspace.mockReset();
  });

  it("sucht nur gespeicherte Wiki-Links und öffnet die konkrete Referenz", async () => {
    const hit = {
      path: "/workspace/Kapitel/Quelle.md",
      name: "Quelle.md",
      relativePath: "Kapitel/Quelle.md",
      line: 12,
      column: 7,
      from: 42,
      to: 61,
      context: "Siehe [[Ziele/Start.md]]",
    };
    mocks.searchWorkspace.mockResolvedValue({
      hits: [hit],
      skippedLarge: 0,
      skippedInvalidUtf8: 0,
      truncated: false,
    });
    const onOpenHit = vi.fn();

    render(
      <BacklinksSidebar
        workspaceRoot="/workspace"
        targetRelativePath={"Ziele\\Start.md"}
        collapsed={false}
        refreshToken={0}
        onToggle={() => undefined}
        onOpenHit={onOpenHit}
        onError={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(mocks.searchWorkspace).toHaveBeenCalledWith(
        "/workspace",
        "[[Ziele/Start.md]]",
        { caseSensitive: true, wholeWord: false },
        [],
      );
    });

    fireEvent.click(await screen.findByRole("button", { name: /12.*Siehe/ }));
    expect(onOpenHit).toHaveBeenCalledWith(hit);
  });

  it("startet ohne gespeichertes Workspace-Ziel keine Suche", () => {
    render(
      <BacklinksSidebar
        workspaceRoot="/workspace"
        targetRelativePath={null}
        collapsed={false}
        refreshToken={0}
        onToggle={() => undefined}
        onOpenHit={() => undefined}
        onError={() => undefined}
      />,
    );

    expect(mocks.searchWorkspace).not.toHaveBeenCalled();
    expect(screen.getByText(/Speichere das aktuelle Dokument/)).toBeTruthy();
  });
});
