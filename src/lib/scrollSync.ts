import type { ScrollAnchor } from "../types";

export interface SourceBlock {
  line: number;
  top: number;
}

export function sourceAnchorAtPreviewTop(
  blocks: SourceBlock[],
  top: number,
): ScrollAnchor | null {
  if (blocks.length === 0) return null;
  const [before, after] = surroundingByTop(blocks, top);
  const height = Math.max(1, after.top - before.top);
  const ratio = Math.min(1, Math.max(0, (top - before.top) / height));
  const lineValue = before.line + (after.line - before.line) * ratio;
  return { line: Math.floor(lineValue), fraction: lineValue % 1 };
}

export function previewTopForSourceAnchor(
  blocks: SourceBlock[],
  anchor: ScrollAnchor,
): number | null {
  if (blocks.length === 0) return null;
  const targetLine = anchor.line + anchor.fraction;
  const [before, after] = surroundingByLine(blocks, targetLine);
  const lineSpan = Math.max(1, after.line - before.line);
  const ratio = Math.min(1, Math.max(0, (targetLine - before.line) / lineSpan));
  return before.top + (after.top - before.top) * ratio;
}

function surroundingByTop(
  blocks: SourceBlock[],
  target: number,
): [SourceBlock, SourceBlock] {
  let before = blocks[0];
  let after = blocks[blocks.length - 1];
  for (const block of blocks) {
    if (block.top <= target) before = block;
    if (block.top >= target) {
      after = block;
      break;
    }
  }
  return [before, after];
}

function surroundingByLine(
  blocks: SourceBlock[],
  target: number,
): [SourceBlock, SourceBlock] {
  let before = blocks[0];
  let after = blocks[blocks.length - 1];
  for (const block of blocks) {
    if (block.line <= target) before = block;
    if (block.line >= target) {
      after = block;
      break;
    }
  }
  return [before, after];
}
