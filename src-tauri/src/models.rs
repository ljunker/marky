use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileRevision {
    pub modified_millis: u64,
    pub size: u64,
    pub hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    pub path: String,
    pub name: String,
    pub source: String,
    pub revision: FileRevision,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub is_symlink: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    pub path: String,
    pub name: String,
    pub relative_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAsset {
    pub relative_path: String,
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDropPayload {
    pub paths: Vec<String>,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Directory,
    Markdown,
    Image,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveResult {
    Saved { revision: FileRevision },
    Conflict { revision: Option<FileRevision> },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetData {
    pub mime_type: String,
    pub base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionState {
    pub workspace_root: Option<String>,
    pub open_paths: Vec<String>,
    pub active_path: Option<String>,
    pub recent_paths: Vec<String>,
    pub expanded_directories: Vec<String>,
    pub sidebar_mode: SidebarMode,
    pub sidebar_collapsed: bool,
    pub sidebar_width: f64,
    pub editor_ratio: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SidebarMode {
    #[default]
    Files,
    Outline,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            workspace_root: None,
            open_paths: Vec::new(),
            active_path: None,
            recent_paths: Vec::new(),
            expanded_directories: Vec::new(),
            sidebar_mode: SidebarMode::Files,
            sidebar_collapsed: false,
            sidebar_width: 270.0,
            editor_ratio: 0.5,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSystemChange {
    pub paths: Vec<String>,
}
