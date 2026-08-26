import { describe, expect, it } from "vitest";
import {
  previewTopForSourceAnchor,
  sourceAnchorAtPreviewTop,
  type SourceBlock,
} from "./scrollSync";

const blocks: SourceBlock[] = [
  { line: 1, top: 0 },
  { line: 11, top: 200 },
  { line: 21, top: 500 },
];

describe("Scroll-Synchronisierung", () => {
  it("interpoliert Vorschauhöhen auf Quellzeilen", () => {
    expect(sourceAnchorAtPreviewTop(blocks, 100)).toEqual({ line: 6, fraction: 0 });
    expect(sourceAnchorAtPreviewTop(blocks, 350)).toEqual({ line: 16, fraction: 0 });
  });

  it("bildet Quellanker wieder auf Vorschauhöhen ab", () => {
    expect(previewTopForSourceAnchor(blocks, { line: 6, fraction: 0 })).toBe(100);
    expect(previewTopForSourceAnchor(blocks, { line: 16, fraction: 0 })).toBe(350);
  });

  it("behandelt leere Dokumente", () => {
    expect(sourceAnchorAtPreviewTop([], 0)).toBeNull();
    expect(previewTopForSourceAnchor([], { line: 1, fraction: 0 })).toBeNull();
  });
});
