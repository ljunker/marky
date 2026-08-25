use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    models::{
        AssetData, DirectoryEntry, DocumentPayload, EntryKind, FileRevision, SaveResult,
        SessionState,
    },
    state::AppState,
};

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown"];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"];
const MAX_IMAGE_BYTES: u64 = 30 * 1024 * 1024;

#[tauri::command]
pub async fn choose_markdown_files(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let selections = app
        .dialog()
        .file()
        .set_title("Markdown-Dateien öffnen")
        .add_filter("Markdown", MARKDOWN_EXTENSIONS)
        .blocking_pick_files()
        .unwrap_or_default();

    let mut paths = Vec::new();
    for selection in selections {
        let path = selection
            .into_path()
            .map_err(|error| format!("Dateipfad ist ungültig: {error}"))?;
        if !is_markdown(&path) {
            continue;
        }
        let canonical = state.authorize_file(&path)?;
        paths.push(path_string(&canonical)?);
    }
    Ok(paths)
}

#[tauri::command]
pub async fn choose_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Markdown-Ordner öffnen")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };

    let path = selection
        .into_path()
        .map_err(|error| format!("Ordnerpfad ist ungültig: {error}"))?;
    let canonical = state.authorize_root(&path)?;
    Ok(Some(path_string(&canonical)?))
}

#[tauri::command]
pub fn authorize_document(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !is_markdown(&path) {
        return Err("Marky kann nur .md- und .markdown-Dateien öffnen".into());
    }
    state
        .authorize_file(&path)
        .and_then(|path| path_string(&path))
}

#[tauri::command]
pub fn list_directory(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, String> {
    let directory = state.ensure_directory_access(Path::new(&path))?;
    let mut entries = Vec::new();
    let iterator = fs::read_dir(&directory)
        .map_err(|error| format!("Ordner kann nicht gelesen werden: {error}"))?;

    for entry in iterator.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }

        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let is_symlink = file_type.is_symlink();
        let target_metadata = if is_symlink {
            fs::metadata(&path).ok()
        } else {
            None
        };
        let is_directory = file_type.is_dir()
            || target_metadata
                .as_ref()
                .is_some_and(std::fs::Metadata::is_dir);

        let kind = if is_directory {
            EntryKind::Directory
        } else if is_markdown(&path) {
            EntryKind::Markdown
        } else if is_image(&path) {
            EntryKind::Image
        } else {
            continue;
        };

        entries.push(DirectoryEntry {
            name,
            path: path_string(&path)?,
            kind,
            is_symlink,
        });
    }

    entries.sort_by(|left, right| {
        let left_directory = matches!(left.kind, EntryKind::Directory);
        let right_directory = matches!(right.kind, EntryKind::Directory);
        right_directory
            .cmp(&left_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_document(path: String, state: State<'_, AppState>) -> Result<DocumentPayload, String> {
    let path = state.ensure_document_access(Path::new(&path))?;
    if !is_markdown(&path) {
        return Err("Marky kann nur .md- und .markdown-Dateien öffnen".into());
    }
    read_document_from_path(&path)
}

#[tauri::command]
pub fn save_document(
    path: String,
    expected_revision: FileRevision,
    source: String,
    state: State<'_, AppState>,
) -> Result<SaveResult, String> {
    let path = state.ensure_document_access(Path::new(&path))?;
    if !is_markdown(&path) {
        return Err("Dieses Dateiformat kann nicht gespeichert werden".into());
    }

    let current = revision_for_path(&path).ok();
    if current.as_ref() != Some(&expected_revision) {
        return Ok(SaveResult::Conflict { revision: current });
    }

    atomic_write(&path, source.as_bytes())?;
    Ok(SaveResult::Saved {
        revision: revision_for_path(&path)?,
    })
}

#[tauri::command]
pub fn read_local_asset(
    document_path: String,
    asset_path: String,
    state: State<'_, AppState>,
) -> Result<AssetData, String> {
    let relative = PathBuf::from(&asset_path);
    if relative.is_absolute() {
        return Err("Absolute Bildpfade sind nicht erlaubt".into());
    }
    let path = state.ensure_asset_access(Path::new(&document_path), &relative)?;
    if !is_image(&path) {
        return Err("Dieses Bildformat wird nicht unterstützt".into());
    }
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Bild kann nicht gelesen werden: {error}"))?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("Das Bild ist größer als 30 MB".into());
    }

    let bytes =
        fs::read(&path).map_err(|error| format!("Bild kann nicht gelesen werden: {error}"))?;
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    Ok(AssetData {
        mime_type: mime.to_string(),
        base64: STANDARD.encode(bytes),
    })
}

#[tauri::command]
pub fn drain_open_paths(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut accepted = Vec::new();
    for path in state.drain_open_paths() {
        if is_markdown(&path)
            && let Ok(canonical) = state.authorize_file(&path)
        {
            accepted.push(path_string(&canonical)?);
        }
    }
    Ok(accepted)
}

#[tauri::command]
pub fn load_session(app: AppHandle, state: State<'_, AppState>) -> Result<SessionState, String> {
    let file = session_file(&app)?;
    if !file.exists() {
        return Ok(SessionState::default());
    }
    let bytes =
        fs::read(&file).map_err(|error| format!("Sitzung kann nicht gelesen werden: {error}"))?;
    let session: SessionState = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Sitzung ist beschädigt: {error}"))?;
    let cleaned = clean_session(session);

    if let Some(root) = cleaned.workspace_root.as_deref() {
        let _ = state.authorize_root(Path::new(root));
    }
    for path in &cleaned.open_paths {
        let _ = state.authorize_file(Path::new(path));
    }
    Ok(cleaned)
}

#[tauri::command]
pub fn save_session(app: AppHandle, session: SessionState) -> Result<(), String> {
    let file = session_file(&app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Sitzungsordner kann nicht erstellt werden: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(&session)
        .map_err(|error| format!("Sitzung kann nicht serialisiert werden: {error}"))?;
    atomic_write_new(&file, &bytes)
}

fn read_document_from_path(path: &Path) -> Result<DocumentPayload, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("Datei kann nicht gelesen werden: {error}"))?;
    let source = String::from_utf8(bytes).map_err(|_| {
        "Die Datei ist nicht als UTF-8 gespeichert und wurde nicht geöffnet".to_string()
    })?;
    Ok(DocumentPayload {
        path: path_string(path)?,
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Markdown".into()),
        revision: revision_for_path(path)?,
        source,
    })
}

fn revision_for_path(path: &Path) -> Result<FileRevision, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("Datei kann nicht geprüft werden: {error}"))?;
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Dateiinformationen sind nicht verfügbar: {error}"))?;
    let modified_millis = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    Ok(FileRevision {
        modified_millis,
        size: metadata.len(),
        hash: blake3::hash(&bytes).to_hex().to_string(),
    })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Dateipfad hat keinen übergeordneten Ordner".to_string())?;
    let permissions = fs::metadata(path)
        .ok()
        .map(|metadata| metadata.permissions());
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Temporäre Datei kann nicht erstellt werden: {error}"))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file_mut().sync_all())
        .map_err(|error| format!("Datei kann nicht geschrieben werden: {error}"))?;
    if let Some(permissions) = permissions {
        temporary
            .as_file()
            .set_permissions(permissions)
            .map_err(|error| format!("Dateirechte können nicht erhalten werden: {error}"))?;
    }
    temporary
        .persist(path)
        .map_err(|error| format!("Datei kann nicht ersetzt werden: {}", error.error))?;
    Ok(())
}

fn atomic_write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.exists() {
        return atomic_write(path, bytes);
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Dateipfad hat keinen übergeordneten Ordner".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Temporäre Datei kann nicht erstellt werden: {error}"))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file_mut().sync_all())
        .map_err(|error| format!("Datei kann nicht geschrieben werden: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("Datei kann nicht erstellt werden: {}", error.error))?;
    Ok(())
}

fn session_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("session.json"))
        .map_err(|error| format!("Sitzungspfad ist nicht verfügbar: {error}"))
}

fn clean_session(mut session: SessionState) -> SessionState {
    session.sidebar_width = session.sidebar_width.clamp(210.0, 480.0);
    session.editor_ratio = session.editor_ratio.clamp(0.25, 0.75);

    session.workspace_root = session
        .workspace_root
        .filter(|path| Path::new(path).is_dir())
        .and_then(|path| Path::new(&path).canonicalize().ok())
        .and_then(|path| path_string(&path).ok());

    let mut seen = HashSet::new();
    session.open_paths = session
        .open_paths
        .into_iter()
        .filter_map(|path| Path::new(&path).canonicalize().ok())
        .filter(|path| path.is_file() && is_markdown(path))
        .filter_map(|path| path_string(&path).ok())
        .filter(|path| seen.insert(path.clone()))
        .collect();

    if session
        .active_path
        .as_ref()
        .is_some_and(|active| !session.open_paths.contains(active))
    {
        session.active_path = session.open_paths.first().cloned();
    }
    if session.active_path.is_none() {
        session.active_path = session.open_paths.first().cloned();
    }

    if let Some(root) = session.workspace_root.as_deref() {
        let root = Path::new(root);
        session.expanded_directories.retain(|path| {
            Path::new(path)
                .canonicalize()
                .is_ok_and(|path| path.is_dir() && path.starts_with(root))
        });
    } else {
        session.expanded_directories.clear();
    }
    session
}

pub fn is_markdown(path: &Path) -> bool {
    has_extension(path, MARKDOWN_EXTENSIONS)
}

pub fn is_image(path: &Path) -> bool {
    has_extension(path, IMAGE_EXTENSIONS)
}

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extensions
                .iter()
                .any(|expected| extension.eq_ignore_ascii_case(expected))
        })
}

fn path_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Der Dateipfad ist nicht als Unicode darstellbar".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_supported_extensions_case_insensitively() {
        assert!(is_markdown(Path::new("Notiz.MD")));
        assert!(is_markdown(Path::new("Notiz.markdown")));
        assert!(is_image(Path::new("bild.WeBp")));
        assert!(!is_markdown(Path::new("Notiz.txt")));
        assert!(!is_image(Path::new("bild.tiff")));
    }

    #[test]
    fn cleans_layout_bounds_and_missing_paths() {
        let cleaned = clean_session(SessionState {
            sidebar_width: 10.0,
            editor_ratio: 0.99,
            workspace_root: Some("/definitely/missing/marky".into()),
            open_paths: vec!["/definitely/missing/readme.md".into()],
            active_path: Some("/definitely/missing/readme.md".into()),
            ..SessionState::default()
        });

        assert_eq!(cleaned.sidebar_width, 210.0);
        assert_eq!(cleaned.editor_ratio, 0.75);
        assert!(cleaned.workspace_root.is_none());
        assert!(cleaned.open_paths.is_empty());
        assert!(cleaned.active_path.is_none());
    }
}
