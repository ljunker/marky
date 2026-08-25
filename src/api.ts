import { invoke } from "@tauri-apps/api/core";
import type {
  AssetData,
  DirectoryEntry,
  DocumentPayload,
  FileRevision,
  ImportedAsset,
  SaveResult,
  SessionState,
  WorkspaceFile,
} from "./types";

export const chooseMarkdownFiles = (): Promise<string[]> =>
  invoke("choose_markdown_files");

export const chooseWorkspace = (): Promise<string | null> =>
  invoke("choose_workspace");

export const chooseDocumentSavePath = (
  suggestedName: string,
): Promise<string | null> =>
  invoke("choose_document_save_path", { suggestedName });

export const cancelDocumentSavePath = (path: string): Promise<void> =>
  invoke("cancel_document_save_path", { path });

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

export const saveDocumentAs = (
  path: string,
  source: string,
): Promise<DocumentPayload> => invoke("save_document_as", { path, source });

export const listWorkspaceMarkdown = (
  root: string,
): Promise<WorkspaceFile[]> => invoke("list_workspace_markdown", { root });

export const importImageFile = (
  documentPath: string,
  sourcePath: string,
): Promise<ImportedAsset> =>
  invoke("import_image_file", { documentPath, sourcePath });

export const cancelImageDrop = (paths: string[]): Promise<void> =>
  invoke("cancel_image_drop", { paths });

export const saveImageBytes = (
  documentPath: string,
  mimeType: string,
  base64: string,
): Promise<ImportedAsset> =>
  invoke("save_image_bytes", { documentPath, mimeType, base64 });

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
