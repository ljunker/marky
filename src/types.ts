export interface FileRevision {
  modifiedMillis: number;
  size: number;
  hash: string;
}

export interface DocumentPayload {
  path: string;
  name: string;
  source: string;
  revision: FileRevision;
}

export interface DocumentState extends DocumentPayload {
  savedSource: string;
  cursor: number;
  scrollTop: number;
  missing?: boolean;
}

export type EntryKind = "directory" | "markdown" | "image";

export interface DirectoryEntry {
  name: string;
  path: string;
  kind: EntryKind;
  isSymlink: boolean;
}

export type SaveResult =
  | { status: "saved"; revision: FileRevision }
  | { status: "conflict"; revision: FileRevision | null };

export interface AssetData {
  mimeType: string;
  base64: string;
}

export interface SessionState {
  workspaceRoot: string | null;
  openPaths: string[];
  activePath: string | null;
  expandedDirectories: string[];
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  editorRatio: number;
}

export interface FileSystemChange {
  paths: string[];
}

export interface DialogButton {
  id: string;
  label: string;
  emphasis?: "primary" | "danger";
}

export interface DialogSpec {
  title: string;
  message: string;
  detail?: string;
  buttons: DialogButton[];
}

export const isDirty = (document: DocumentState): boolean =>
  document.source !== document.savedSource;
