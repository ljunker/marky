import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readLocalAsset } from "../api";
import { renderMarkdown } from "../lib/markdown";

interface MarkdownPreviewProps {
  documentPath: string;
  source: string;
}

export function MarkdownPreview({
  documentPath,
  source,
}: MarkdownPreviewProps) {
  const [html, setHtml] = useState(() => renderMarkdown(source));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setHtml(renderMarkdown(source)), 100);
    return () => window.clearTimeout(timer);
  }, [source]);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    const images = containerRef.current?.querySelectorAll<HTMLImageElement>(
      "img[data-local-src]",
    );
    images?.forEach((image) => {
      const sourcePath = image.dataset.localSrc;
      if (!sourcePath) return;
      let decodedPath = sourcePath.split(/[?#]/, 1)[0];
      try {
        decodedPath = decodeURIComponent(decodedPath);
      } catch {
        // Keep the literal path if it is not percent encoded correctly.
      }
      void readLocalAsset(documentPath, decodedPath)
        .then((asset) => {
          if (cancelled) return;
          const binary = window.atob(asset.base64);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
          }
          const objectUrl = URL.createObjectURL(
            new Blob([bytes], { type: asset.mimeType }),
          );
          objectUrls.push(objectUrl);
          image.src = objectUrl;
        })
        .catch(() => {
          if (!cancelled) {
            image.classList.add("missing-image");
            image.alt = image.alt
              ? `${image.alt} (Bild nicht gefunden)`
              : "Bild nicht gefunden";
          }
        });
    });
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [documentPath, html]);

  return (
    <div
      ref={containerRef}
      className="markdown-preview"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        const anchor = target.closest<HTMLAnchorElement>("a");
        if (!anchor) return;
        const href = anchor.getAttribute("href");
        if (!href || href.startsWith("#")) return;
        event.preventDefault();
        if (/^(https?:|mailto:)/i.test(href)) void openUrl(href);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
