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

export interface DocumentState {
  id: string;
  path: string | null;
  name: string;
  source: string;
  revision: FileRevision | null;
  savedSource: string | null;
  selectionFrom: number;
  selectionTo: number;
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

export interface WorkspaceFile {
  path: string;
  name: string;
  relativePath: string;
}

export interface ImportedAsset {
  relativePath: string;
  displayName: string;
}

export interface ImageDropPayload {
  paths: string[];
  x: number;
  y: number;
}

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
  offset: number;
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
  recentPaths: string[];
  expandedDirectories: string[];
  sidebarMode: SidebarMode;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  editorRatio: number;
}

export type SidebarMode = "files" | "outline";

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
  document.savedSource === null || document.source !== document.savedSource;
