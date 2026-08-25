import type { ImportedAsset } from "../types";
import type { MarkdownEdit } from "./formatting";

export function createListContinuationEdit(
  source: string,
  from: number,
  to: number,
): MarkdownEdit | null {
  if (from !== to) return null;
  const lineFrom = source.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const nextBreak = source.indexOf("\n", from);
  const lineTo = nextBreak < 0 ? source.length : nextBreak;
  const line = source.slice(lineFrom, lineTo);
  const relativeCursor = from - lineFrom;

  const task = /^(\s*)-\s+\[[ xX]\]\s?(.*)$/.exec(line);
  const bullet = /^(\s*)([-+*])\s+(.*)$/.exec(line);
  const ordered = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
  const match = task ?? bullet ?? ordered;
  if (!match) return null;

  const content = match[match.length - 1];
  if (!content.trim()) {
    const indentation = match[1];
    return {
      from: lineFrom,
      to: lineTo,
      insert: indentation,
      selectionFrom: lineFrom + indentation.length,
      selectionTo: lineFrom + indentation.length,
    };
  }

  const prefix = task
    ? `${task[1]}- [ ] `
    : bullet
      ? `${bullet[1]}${bullet[2]} `
      : `${ordered![1]}${Number(ordered![2]) + 1}. `;
  if (relativeCursor < line.length - content.length) return null;
  const insert = `\n${prefix}`;
  return {
    from,
    to,
    insert,
    selectionFrom: from + insert.length,
    selectionTo: from + insert.length,
  };
}

export function createSmartUrlPasteEdit(
  source: string,
  from: number,
  to: number,
  clipboardText: string,
): MarkdownEdit | null {
  const url = clipboardText.trim();
  if (from === to || !/^https?:\/\/\S+$/i.test(url)) return null;
  const label = escapeMarkdownLabel(source.slice(from, to));
  const insert = `[${label}](${url})`;
  return {
    from,
    to,
    insert,
    selectionFrom: from + insert.length,
    selectionTo: from + insert.length,
  };
}

export function createImageMarkdown(
  assets: ImportedAsset[],
  selectedText: string,
): string {
  return assets
    .map((asset) => {
      const alt = selectedText.trim()
        ? selectedText.trim()
        : asset.displayName || "Bild";
      return `![${escapeMarkdownLabel(alt)}](${asset.relativePath})`;
    })
    .join("\n");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1");
}
