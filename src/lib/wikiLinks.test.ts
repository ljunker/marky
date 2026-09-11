import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  createWikiLinkCompletionSource,
  createWikiLinkSearchQuery,
  normalizeWikiLinkPath,
} from "./wikiLinks";

const files = [
  {
    path: "/workspace/Kapitel/Start.md",
    name: "Start.md",
    relativePath: "Kapitel/Start.md",
  },
  {
    path: "/workspace/Notizen.markdown",
    name: "Notizen.markdown",
    relativePath: "Notizen.markdown",
  },
];

describe("Wiki-Link-Autovervollständigung", () => {
  it("schlägt Workspace-Pfade nach einer öffnenden Doppelklammer vor", async () => {
    const state = EditorState.create({ doc: "Siehe [[Kap" });
    const context = new CompletionContext(state, state.doc.length, false);
    const result = await createWikiLinkCompletionSource(files)(context);

    expect(result?.from).toBe(8);
    expect(result?.options.map(({ label, apply }) => ({ label, apply }))).toEqual([
      { label: "Kapitel/Start.md", apply: "Kapitel/Start.md]]" },
      { label: "Notizen.markdown", apply: "Notizen.markdown]]" },
    ]);
  });

  it("bleibt außerhalb eines offenen Wiki-Links inaktiv", async () => {
    const state = EditorState.create({ doc: "Siehe Kapitel" });
    const context = new CompletionContext(state, state.doc.length, false);

    expect(await createWikiLinkCompletionSource(files)(context)).toBeNull();
    expect(await createWikiLinkCompletionSource([])(context)).toBeNull();
  });

  it("normalisiert Windows-Pfade für portierbare Wiki-Links", () => {
    expect(normalizeWikiLinkPath("Kapitel\\Start.md")).toBe("Kapitel/Start.md");
  });

  it("erzeugt die exakte Suchsyntax für Backlinks", () => {
    expect(createWikiLinkSearchQuery("Kapitel\\Start.md")).toBe(
      "[[Kapitel/Start.md]]",
    );
  });
});
