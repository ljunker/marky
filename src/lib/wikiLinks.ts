import type {
  Completion,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { WorkspaceFile } from "../types";

export function normalizeWikiLinkPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

export function createWikiLinkSearchQuery(relativePath: string): string {
  return `[[${normalizeWikiLinkPath(relativePath)}]]`;
}

export function createWikiLinkCompletionSource(
  files: WorkspaceFile[],
): CompletionSource {
  const options: Completion[] = files.map((file) => {
    const relativePath = normalizeWikiLinkPath(file.relativePath);
    return {
      label: relativePath,
      apply: `${relativePath}]]`,
      detail: "Wiki-Link",
      type: "text",
    };
  });

  return (context) => {
    if (options.length === 0) return null;
    const match = context.matchBefore(/\[\[[^\]\n]*/);
    if (!match) return null;
    return {
      from: match.from + 2,
      options,
      validFor: /^[^\]\n]*$/,
    };
  };
}
