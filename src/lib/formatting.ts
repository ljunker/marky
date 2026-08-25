export type MarkdownAction =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "link"
  | "image"
  | "table";

export interface MarkdownEdit {
  from: number;
  to: number;
  insert: string;
  selectionFrom: number;
  selectionTo: number;
}

export function createMarkdownEdit(
  source: string,
  selectionFrom: number,
  selectionTo: number,
  action: MarkdownAction,
): MarkdownEdit {
  const from = Math.min(selectionFrom, selectionTo);
  const to = Math.max(selectionFrom, selectionTo);

  switch (action) {
    case "bold":
      return inlineEdit(source, from, to, "**", "**");
    case "italic":
      return inlineEdit(source, from, to, "*", "*");
    case "strike":
      return inlineEdit(source, from, to, "~~", "~~");
    case "code":
      return inlineEdit(source, from, to, "`", "`");
    case "heading":
    case "bulletList":
    case "orderedList":
    case "taskList":
    case "quote":
      return lineEdit(source, from, to, action);
    case "link":
      return linkEdit(source, from, to);
    case "image":
      return imageEdit(source, from, to);
    case "table":
      return tableEdit(source, from, to);
  }
}

function inlineEdit(
  source: string,
  from: number,
  to: number,
  prefix: string,
  suffix: string,
): MarkdownEdit {
  const selected = source.slice(from, to);
  const selectedHasMarkers =
    selected.length >= prefix.length + suffix.length &&
    selected.startsWith(prefix) &&
    selected.endsWith(suffix) &&
    !(
      prefix === "*" &&
      (selected.startsWith("**") || selected.endsWith("**"))
    );

  if (selectedHasMarkers) {
    const insert = selected.slice(prefix.length, selected.length - suffix.length);
    return {
      from,
      to,
      insert,
      selectionFrom: from,
      selectionTo: from + insert.length,
    };
  }

  const hasSurroundingMarkers =
    from >= prefix.length &&
    source.slice(from - prefix.length, from) === prefix &&
    source.slice(to, to + suffix.length) === suffix &&
    !(
      prefix === "*" &&
      (source[from - prefix.length - 1] === "*" ||
        source[to + suffix.length] === "*")
    );

  if (hasSurroundingMarkers && from !== to) {
    return {
      from: from - prefix.length,
      to: to + suffix.length,
      insert: selected,
      selectionFrom: from - prefix.length,
      selectionTo: to - prefix.length,
    };
  }

  const insert = `${prefix}${selected}${suffix}`;
  return {
    from,
    to,
    insert,
    selectionFrom: from + prefix.length,
    selectionTo: from + prefix.length + selected.length,
  };
}

function lineEdit(
  source: string,
  from: number,
  to: number,
  action: Extract<
    MarkdownAction,
    "heading" | "bulletList" | "orderedList" | "taskList" | "quote"
  >,
): MarkdownEdit {
  const editFrom = source.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const relevantTo = to > from && source[to - 1] === "\n" ? to - 1 : to;
  const nextBreak = source.indexOf("\n", relevantTo);
  const editTo = nextBreak === -1 ? source.length : nextBreak;
  const lines = source.slice(editFrom, editTo).split("\n");

  const pattern = linePattern(action);
  const populated = lines.filter((line) => line.trim().length > 0);
  const remove = populated.length > 0 && populated.every((line) => pattern.test(line));
  let visibleIndex = 0;
  const transformed = lines.map((line) => {
    if (!line.trim()) return line;
    if (remove) return line.replace(pattern, "");
    visibleIndex += 1;
    const content = stripCompetingPrefix(line, action);
    return `${linePrefix(action, visibleIndex)}${content}`;
  });
  const insert = transformed.join("\n");

  return {
    from: editFrom,
    to: editTo,
    insert,
    selectionFrom: editFrom,
    selectionTo: editFrom + insert.length,
  };
}

function linePattern(
  action: Extract<
    MarkdownAction,
    "heading" | "bulletList" | "orderedList" | "taskList" | "quote"
  >,
): RegExp {
  switch (action) {
    case "heading":
      return /^##\s+/;
    case "bulletList":
      return /^-\s+(?!\[[ xX]\]\s+)/;
    case "orderedList":
      return /^\d+\.\s+/;
    case "taskList":
      return /^-\s+\[[ xX]\]\s+/;
    case "quote":
      return /^>\s?/;
  }
}

function linePrefix(
  action: Extract<
    MarkdownAction,
    "heading" | "bulletList" | "orderedList" | "taskList" | "quote"
  >,
  index: number,
): string {
  switch (action) {
    case "heading":
      return "## ";
    case "bulletList":
      return "- ";
    case "orderedList":
      return `${index}. `;
    case "taskList":
      return "- [ ] ";
    case "quote":
      return "> ";
  }
}

function stripCompetingPrefix(line: string, action: MarkdownAction): string {
  if (action === "heading") return line.replace(/^#{1,6}\s+/, "");
  if (action === "quote") return line.replace(/^>\s?/, "");
  return line.replace(/^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, "");
}

function linkEdit(source: string, from: number, to: number): MarkdownEdit {
  const selected = source.slice(from, to);
  const label = selected || "Linktext";
  const insert = `[${label}](https://)`;
  const selectionFrom = selected ? from + label.length + 3 : from + 1;
  const selectionTo = selected
    ? selectionFrom + "https://".length
    : selectionFrom + label.length;
  return { from, to, insert, selectionFrom, selectionTo };
}

function imageEdit(source: string, from: number, to: number): MarkdownEdit {
  const selected = source.slice(from, to);
  const label = selected || "Alt-Text";
  const insert = `![${label}](bild.png)`;
  const selectionFrom = selected ? from + label.length + 4 : from + 2;
  const selectionTo = selected
    ? selectionFrom + "bild.png".length
    : selectionFrom + label.length;
  return { from, to, insert, selectionFrom, selectionTo };
}

function tableEdit(source: string, from: number, to: number): MarkdownEdit {
  const selected = source
    .slice(from, to)
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ");
  const content = selected || "Inhalt";
  const insert = `| Spalte 1 | Spalte 2 |\n| --- | --- |\n| ${content} |  |`;
  const contentStart = from + insert.lastIndexOf(content);
  return {
    from,
    to,
    insert,
    selectionFrom: contentStart,
    selectionTo: contentStart + content.length,
  };
}
