import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import githubTheme from "highlight.js/styles/github.css?inline";
import githubDarkTheme from "highlight.js/styles/github-dark.css?inline";
import atomOneDarkTheme from "highlight.js/styles/atom-one-dark.css?inline";
import { readLocalAsset } from "../api";
import { renderMarkdown } from "../lib/markdown";
import {
  previewTopForSourceAnchor,
  sourceAnchorAtPreviewTop,
  type SourceBlock,
} from "../lib/scrollSync";
import type { PreviewSettings, ScrollAnchor } from "../types";
import previewStyles from "../preview.css?inline";

export interface MarkdownPreviewHandle {
  scrollToSource: (anchor: ScrollAnchor) => void;
}

interface MarkdownPreviewProps {
  documentPath: string | null;
  source: string;
  settings: PreviewSettings;
  customCss: string;
  darkMode: boolean;
  onScrollAnchor: (anchor: ScrollAnchor) => void;
}

export const MarkdownPreview = forwardRef<MarkdownPreviewHandle, MarkdownPreviewProps>(
  function MarkdownPreview(
    { documentPath, source, settings, customCss, darkMode, onScrollAnchor },
    forwardedRef,
  ) {
    const [html, setHtml] = useState(() => renderMarkdown(source));
    const hostRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const articleRef = useRef<HTMLElement | null>(null);
    const themeRef = useRef<HTMLStyleElement | null>(null);
    const customStyleRef = useRef<HTMLStyleElement | null>(null);
    const onScrollAnchorRef = useRef(onScrollAnchor);
    onScrollAnchorRef.current = onScrollAnchor;

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      shadow.replaceChildren();

      const baseStyle = document.createElement("style");
      baseStyle.textContent = previewStyles;
      const themeStyle = document.createElement("style");
      const customStyle = document.createElement("style");
      const scroll = document.createElement("div");
      scroll.className = "preview-scroll";
      const article = document.createElement("article");
      article.className = "markdown-preview";
      scroll.append(article);
      shadow.append(baseStyle, themeStyle, customStyle, scroll);
      themeRef.current = themeStyle;
      customStyleRef.current = customStyle;
      scrollRef.current = scroll;
      articleRef.current = article;

      let frame = 0;
      const onScroll = () => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          const anchor = anchorForPreviewScroll(scroll, article);
          if (anchor) onScrollAnchorRef.current(anchor);
        });
      };
      const onClick = (event: Event) => {
        const target = event.target as Element | null;
        const anchor = target?.closest<HTMLAnchorElement>("a");
        if (!anchor) return;
        const href = anchor.getAttribute("href");
        if (!href || href.startsWith("#")) return;
        event.preventDefault();
        if (/^(https?:|mailto:)/i.test(href)) void openUrl(href);
      };
      scroll.addEventListener("scroll", onScroll, { passive: true });
      article.addEventListener("click", onClick);
      return () => {
        window.cancelAnimationFrame(frame);
        scroll.removeEventListener("scroll", onScroll);
        article.removeEventListener("click", onClick);
        scrollRef.current = null;
        articleRef.current = null;
        themeRef.current = null;
        customStyleRef.current = null;
      };
    }, []);

    useEffect(() => {
      const timer = window.setTimeout(() => setHtml(renderMarkdown(source)), 100);
      return () => window.clearTimeout(timer);
    }, [source]);

    useEffect(() => {
      if (articleRef.current) articleRef.current.innerHTML = html;
    }, [html]);

    useEffect(() => {
      const article = articleRef.current;
      if (!article) return;
      article.style.setProperty("--preview-font-size", `${settings.fontSize}px`);
      article.style.maxWidth = settings.contentWidth
        ? `${settings.contentWidth}px`
        : "none";
      if (themeRef.current) {
        themeRef.current.textContent = selectTheme(settings.codeTheme, darkMode);
      }
      if (customStyleRef.current) customStyleRef.current.textContent = customCss;
    }, [customCss, darkMode, settings]);

    useEffect(() => {
      const article = articleRef.current;
      if (!article || !documentPath) return;
      let cancelled = false;
      const objectUrls: string[] = [];
      article.querySelectorAll<HTMLImageElement>("img[data-local-src]").forEach((image) => {
        const sourcePath = image.dataset.localSrc;
        if (!sourcePath) return;
        let decodedPath = sourcePath.split(/[?#]/, 1)[0];
        try {
          decodedPath = decodeURIComponent(decodedPath);
        } catch {
          // Keep malformed percent-encoding literal and let Rust reject it safely.
        }
        void readLocalAsset(documentPath, decodedPath)
          .then((asset) => {
            if (cancelled) return;
            const binary = window.atob(asset.base64);
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
            const objectUrl = URL.createObjectURL(new Blob([bytes], { type: asset.mimeType }));
            objectUrls.push(objectUrl);
            image.src = objectUrl;
          })
          .catch(() => {
            if (cancelled) return;
            image.classList.add("missing-image");
            image.alt = image.alt
              ? `${image.alt} (Bild nicht gefunden)`
              : "Bild nicht gefunden";
          });
      });
      return () => {
        cancelled = true;
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
      };
    }, [documentPath, html]);

    useImperativeHandle(forwardedRef, () => ({
      scrollToSource(anchor) {
        const scroll = scrollRef.current;
        const article = articleRef.current;
        if (!scroll || !article) return;
        const blocks = previewBlocks(article);
        const top = previewTopForSourceAnchor(blocks, anchor);
        if (top !== null) scroll.scrollTop = top;
      },
    }), []);

    return <div ref={hostRef} className="markdown-preview-host" />;
  },
);

function previewBlocks(article: HTMLElement): SourceBlock[] {
  const result: SourceBlock[] = [];
  for (const element of article.querySelectorAll<HTMLElement>("[data-source-line]")) {
    const line = Number(element.dataset.sourceLine);
    if (!Number.isFinite(line)) continue;
    const top = element.offsetTop;
    const previous = result[result.length - 1];
    if (previous && (previous.line === line || previous.top === top)) continue;
    result.push({ line, top });
  }
  result.sort((left, right) => left.top - right.top || left.line - right.line);
  return result;
}

function anchorForPreviewScroll(
  scroll: HTMLElement,
  article: HTMLElement,
): ScrollAnchor | null {
  const blocks = previewBlocks(article);
  return sourceAnchorAtPreviewTop(blocks, scroll.scrollTop + 1);
}

function selectTheme(
  theme: PreviewSettings["codeTheme"],
  darkMode: boolean,
): string {
  if (theme === "github-dark") return githubDarkTheme;
  if (theme === "atom-one-dark") return atomOneDarkTheme;
  return darkMode ? githubDarkTheme : githubTheme;
}
