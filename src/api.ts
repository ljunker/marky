import { invoke } from "@tauri-apps/api/core";
import type {
  AssetData,
  DirectoryEntry,
  DocumentPayload,
  FileRevision,
  SaveResult,
  SessionState,
} from "./types";

export const chooseMarkdownFiles = (): Promise<string[]> =>
  invoke("choose_markdown_files");

export const chooseWorkspace = (): Promise<string | null> =>
  invoke("choose_workspace");

export const authorizeDocument = (path: string): Promise<string> =>
  invoke("authorize_document", { path });

export const listDirectory = (path: string): Promise<DirectoryEntry[]> =>
  invoke("list_directory", { path });

export const readDocument = (path: string): Promise<DocumentPayload> =>
  invoke("read_document", { path });

export const saveDocument = (
  path: string,
  expectedRevision: FileRevision,
  source: string,
): Promise<SaveResult> =>
  invoke("save_document", { path, expectedRevision, source });

export const readLocalAsset = (
  documentPath: string,
  assetPath: string,
): Promise<AssetData> =>
  invoke("read_local_asset", { documentPath, assetPath });

export const drainOpenPaths = (): Promise<string[]> =>
  invoke("drain_open_paths");

export const loadSession = (): Promise<SessionState> => invoke("load_session");

export const saveSession = (session: SessionState): Promise<void> =>
  invoke("save_session", { session });

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Ein unbekannter Fehler ist aufgetreten";
}
