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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub id: String,
    pub path: Option<String>,
    pub name: String,
    pub source: String,
    pub saved_source: Option<String>,
    pub revision: Option<FileRevision>,
    pub selection_from: usize,
    pub selection_to: usize,
    pub scroll_top: f64,
    pub updated_at_millis: u64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceSearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchOverride {
    pub path: String,
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchHit {
    pub path: String,
    pub name: String,
    pub relative_path: String,
    pub line: usize,
    pub column: usize,
    pub from: usize,
    pub to: usize,
    pub context: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResponse {
    pub hits: Vec<WorkspaceSearchHit>,
    pub skipped_large: usize,
    pub skipped_invalid_utf8: usize,
    pub truncated: bool,
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
    Search,
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

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CodeTheme {
    #[default]
    SystemGithub,
    GithubDark,
    AtomOneDark,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PreviewSettings {
    pub font_size: f64,
    pub content_width: Option<f64>,
    pub code_theme: CodeTheme,
    pub scroll_sync_enabled: bool,
}

impl Default for PreviewSettings {
    fn default() -> Self {
        Self {
            font_size: 15.0,
            content_width: None,
            code_theme: CodeTheme::SystemGithub,
            scroll_sync_enabled: true,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub preview: PreviewSettings,
    pub custom_css_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCssPayload {
    pub path: String,
    pub source: String,
    pub revision: FileRevision,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSystemChange {
    pub paths: Vec<String>,
}
