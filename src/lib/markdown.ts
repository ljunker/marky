import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import MarkdownIt, {
  type MarkdownIt as MarkdownItInstance,
  type RendererRule,
} from "markdown-it";
import taskLists from "markdown-it-task-lists";
import type { OutlineItem } from "../types";

const transparentPixel =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdownLanguage);
hljs.registerLanguage("md", markdownLanguage);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

const markdown: MarkdownItInstance = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  highlight(source, language): string {
    if (language && hljs.getLanguage(language)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(source, { language }).value}</code></pre>`;
      } catch {
        // Fallback below keeps invalid language declarations harmless.
      }
    }
    return `<pre class="hljs"><code>${markdown.utils.escapeHtml(source)}</code></pre>`;
  },
});

markdown.use(taskLists, { enabled: false, label: true, labelAfter: true });
markdown.core.ruler.after("block", "marky-source-lines", (state) => {
  for (const token of state.tokens) {
    if (token.map && token.block && token.nesting !== -1) {
      token.attrSet("data-source-line", String(token.map[0] + 1));
    }
  }
});

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/, 1)[0];
  const className = language
    ? ` class="language-${markdown.utils.escapeHtml(language)}"`
    : "";
  let highlighted = markdown.utils.escapeHtml(token.content);
  if (language && hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(token.content, { language }).value;
    } catch {
      // Invalid language input remains escaped plain text.
    }
  }
  const line = token.map ? token.map[0] + 1 : 1;
  return `<pre class="hljs" data-source-line="${line}"><code${className}>${highlighted}</code></pre>\n`;
};

markdown.renderer.rules.code_block = (tokens, index) => {
  const token = tokens[index];
  const line = token.map ? token.map[0] + 1 : 1;
  return `<pre class="hljs" data-source-line="${line}"><code>${markdown.utils.escapeHtml(token.content)}</code></pre>\n`;
};

const defaultImageRenderer = markdown.renderer.rules.image;
const imageRenderer: RendererRule = (
  tokens,
  index,
  options,
  environment,
  renderer,
) => {
  const token = tokens[index];
  const source = String(token.attrGet("src") ?? "");
  if (isRelativeAsset(source)) {
    token.attrSet("data-local-src", source);
    token.attrSet("src", transparentPixel);
  }
  if (defaultImageRenderer) {
    return defaultImageRenderer(tokens, index, options, environment, renderer);
  }
  return renderer.renderToken(tokens, index, options);
};
markdown.renderer.rules.image = imageRenderer;

const defaultLinkOpenRenderer = markdown.renderer.rules.link_open;
const linkRenderer: RendererRule = (
  tokens,
  index,
  options,
  environment,
  renderer,
) => {
  tokens[index].attrSet("rel", "noreferrer noopener");
  tokens[index].attrSet("target", "_blank");
  if (defaultLinkOpenRenderer) {
    return defaultLinkOpenRenderer(tokens, index, options, environment, renderer);
  }
  return renderer.renderToken(tokens, index, options);
};
markdown.renderer.rules.link_open = linkRenderer;

export function isRelativeAsset(source: string): boolean {
  return (
    source.length > 0 &&
    !source.startsWith("/") &&
    !source.startsWith("#") &&
    !/^[a-z][a-z\d+.-]*:/i.test(source)
  );
}

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(markdown.render(source), {
    USE_PROFILES: { html: true },
    ADD_ATTR: [
      "checked",
      "data-local-src",
      "data-source-line",
      "disabled",
      "rel",
      "target",
      "type",
    ],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["srcdoc"],
  });
}

export interface TextStats {
  words: number;
  characters: number;
  lines: number;
  readingMinutes: number;
}

export function extractOutline(source: string): OutlineItem[] {
  const tokens = markdown.parse(source, {});
  const lineOffsets = buildLineOffsets(source);
  const items: OutlineItem[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open" || !token.map) continue;
    const level = Number(token.tag.slice(1));
    const inline = tokens[index + 1];
    const text = inline?.type === "inline"
      ? visibleInlineText(inline.children ?? [], true).trim()
      : "";
    const lineIndex = token.map[0];
    items.push({
      level,
      text: text || "(Ohne Titel)",
      line: lineIndex + 1,
      offset: lineOffsets[lineIndex] ?? 0,
    });
  }
  return items;
}

export function computeTextStats(source: string): TextStats {
  const tokens = markdown.parse(source, {});
  const visibleText = tokens
    .filter((token) => token.type === "inline")
    .map((token) => visibleInlineText(token.children ?? [], false))
    .join(" ");
  const words = visibleText.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’\-]*/gu)?.length ?? 0;
  return {
    words,
    characters: [...source].length,
    lines: source.split("\n").length,
    readingMinutes: words === 0 ? 0 : Math.ceil(words / 200),
  };
}

function visibleInlineText(
  tokens: Array<{ type: string; content: string }>,
  includeCode: boolean,
): string {
  return tokens
    .map((token) => {
      if (token.type === "text" || token.type === "image") return token.content;
      if (includeCode && token.type === "code_inline") return token.content;
      if (token.type === "softbreak" || token.type === "hardbreak") return " ";
      return "";
    })
    .join("");
}

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}
