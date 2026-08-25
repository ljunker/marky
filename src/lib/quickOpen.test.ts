import { describe, expect, it } from "vitest";
import { rankQuickOpen, type QuickOpenCandidate } from "./quickOpen";

const candidates: QuickOpenCandidate[] = [
  { path: "/docs/alpha.md", name: "alpha.md", relativePath: "alpha.md", isOpen: false, recentRank: null },
  { path: "/docs/projekt/bericht.md", name: "bericht.md", relativePath: "projekt/bericht.md", isOpen: true, recentRank: 1 },
  { path: "/docs/ideen.md", name: "ideen.md", relativePath: "ideen.md", isOpen: false, recentRank: 0 },
];

describe("Schnellöffnen", () => {
  it("ordnet ohne Suchtext nach Verlauf", () => {
    expect(rankQuickOpen(candidates, "").map((item) => item.name)).toEqual([
      "ideen.md",
      "bericht.md",
      "alpha.md",
    ]);
  });

  it("findet unscharf über relative Pfade", () => {
    expect(rankQuickOpen(candidates, "prjbr")[0]?.name).toBe("bericht.md");
  });
});
