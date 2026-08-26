use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use regex::RegexBuilder;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    models::{
        AppSettings, AssetData, DirectoryEntry, DocumentPayload, EntryKind, FileRevision,
        ImportedAsset, PreviewCssPayload, RecoverySnapshot, SaveResult, SessionState,
        WorkspaceFile, WorkspaceSearchHit, WorkspaceSearchOptions, WorkspaceSearchOverride,
        WorkspaceSearchResponse,
    },
    state::AppState,
};

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown"];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"];
const MAX_IMAGE_BYTES: u64 = 30 * 1024 * 1024;
const MAX_RECENT_PATHS: usize = 30;
const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SEARCH_HITS_PER_FILE: usize = 50;
const MAX_SEARCH_HITS_TOTAL: usize = 500;
const MAX_PREVIEW_CSS_BYTES: u64 = 1024 * 1024;
const MAX_RECOVERY_SOURCE_BYTES: usize = 32 * 1024 * 1024;
const RECOVERY_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

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
pub async fn choose_document_save_path(
    app: AppHandle,
    suggested_name: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Markdown-Datei speichern")
        .set_file_name(suggested_name)
        .add_filter("Markdown", MARKDOWN_EXTENSIONS)
        .blocking_save_file()
    else {
        return Ok(None);
    };

    let mut path = selection
        .into_path()
        .map_err(|error| format!("Dateipfad ist ungültig: {error}"))?;
    if path.extension().is_none() {
        path.set_extension("md");
    }
    if !is_markdown(&path) {
        return Err("Dateien müssen die Erweiterung .md oder .markdown haben".into());
    }
    let normalized = state.authorize_save_target(&path)?;
    Ok(Some(path_string(&normalized)?))
}

#[tauri::command]
pub fn save_document_as(
    path: String,
    source: String,
    state: State<'_, AppState>,
) -> Result<DocumentPayload, String> {
    let path = state.consume_save_target(Path::new(&path))?;
    if !is_markdown(&path) {
        return Err("Dateien müssen die Erweiterung .md oder .markdown haben".into());
    }
    if path.exists() {
        let existing = fs::read(&path)
            .map_err(|error| format!("Vorhandene Datei kann nicht geprüft werden: {error}"))?;
        String::from_utf8(existing).map_err(|_| {
            "Die vorhandene Datei ist nicht als UTF-8 gespeichert und wird nicht überschrieben"
                .to_string()
        })?;
        atomic_write(&path, source.as_bytes())?;
    } else {
        atomic_create(&path, source.as_bytes())?;
    }
    let canonical = state.authorize_file(&path)?;
    read_document_from_path(&canonical)
}

#[tauri::command]
pub fn cancel_document_save_path(path: String, state: State<'_, AppState>) -> Result<(), String> {
    state.revoke_save_target(Path::new(&path))
}

#[tauri::command]
pub fn list_workspace_markdown(
    root: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceFile>, String> {
    let root = state.ensure_directory_access(Path::new(&root))?;
    let mut files = Vec::new();
    collect_workspace_markdown(&root, &root, &mut files)?;
    files.sort_by(|left, right| {
        left.relative_path
            .to_lowercase()
            .cmp(&right.relative_path.to_lowercase())
    });
    Ok(files)
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
pub fn import_image_file(
    document_path: String,
    source_path: String,
    state: State<'_, AppState>,
) -> Result<ImportedAsset, String> {
    let source = state.consume_dropped_file(Path::new(&source_path))?;
    if !is_image(&source) {
        return Err("Dieses Bildformat wird nicht unterstützt".into());
    }
    let metadata = fs::metadata(&source)
        .map_err(|error| format!("Bilddatei kann nicht geprüft werden: {error}"))?;
    validate_image_size(metadata.len())?;
    let bytes = fs::read(&source)
        .map_err(|error| format!("Bilddatei kann nicht gelesen werden: {error}"))?;
    let original_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("bild.png");
    write_asset(&document_path, original_name, &bytes, &state)
}

#[tauri::command]
pub fn cancel_image_drop(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let paths = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
    state.revoke_dropped_files(&paths)
}

#[tauri::command]
pub fn save_image_bytes(
    document_path: String,
    mime_type: String,
    base64: String,
    state: State<'_, AppState>,
) -> Result<ImportedAsset, String> {
    let extension = extension_for_clipboard_mime(&mime_type).ok_or_else(|| {
        "Dieses Bildformat aus der Zwischenablage wird nicht unterstützt".to_string()
    })?;
    let bytes = STANDARD
        .decode(base64)
        .map_err(|_| "Bilddaten aus der Zwischenablage sind ungültig".to_string())?;
    validate_image_size(bytes.len() as u64)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    write_asset(
        &document_path,
        &format!("image-{timestamp}.{extension}"),
        &bytes,
        &state,
    )
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
    for path in &cleaned.recent_paths {
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

#[tauri::command]
pub fn load_recovery(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<RecoverySnapshot>, String> {
    let directory = recovery_directory(&app)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }

    let now = SystemTime::now();
    let mut snapshots = Vec::new();
    let entries = fs::read_dir(&directory)
        .map_err(|error| format!("Wiederherstellung kann nicht gelesen werden: {error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .is_some_and(|modified| recovery_is_stale(modified, now));
        if stale {
            let _ = fs::remove_file(path);
            continue;
        }

        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let Ok(mut snapshot) = serde_json::from_slice::<RecoverySnapshot>(&bytes) else {
            continue;
        };
        if snapshot.id.is_empty() || snapshot.source.len() > MAX_RECOVERY_SOURCE_BYTES {
            continue;
        }
        if snapshot.saved_source.as_ref() == Some(&snapshot.source) {
            let _ = fs::remove_file(path);
            continue;
        }
        let maximum_offset = snapshot.source.encode_utf16().count();
        snapshot.selection_from = snapshot.selection_from.min(maximum_offset);
        snapshot.selection_to = snapshot.selection_to.min(maximum_offset);

        if let Some(original_path) = snapshot.path.as_deref() {
            let source_path = Path::new(original_path);
            if source_path.is_file() && is_markdown(source_path) {
                if let Ok(canonical) = state.ensure_document_access(source_path) {
                    snapshot.path = path_string(&canonical).ok();
                } else {
                    snapshot.path = None;
                    snapshot.revision = None;
                    snapshot.saved_source = None;
                }
            } else {
                snapshot.path = None;
                snapshot.revision = None;
                snapshot.saved_source = None;
            }
        }
        snapshots.push(snapshot);
    }
    snapshots.sort_by_key(|snapshot| snapshot.updated_at_millis);
    Ok(snapshots)
}

#[tauri::command]
pub fn save_recovery_snapshot(
    app: AppHandle,
    mut snapshot: RecoverySnapshot,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if snapshot.id.trim().is_empty() || snapshot.id.len() > 200 {
        return Err("Wiederherstellungs-ID ist ungültig".into());
    }
    if snapshot.source.len() > MAX_RECOVERY_SOURCE_BYTES {
        return Err("Das Dokument ist zu groß für die automatische Wiederherstellung".into());
    }
    if let Some(path) = snapshot.path.as_deref() {
        match state.ensure_document_access(Path::new(path)) {
            Ok(canonical) => snapshot.path = Some(path_string(&canonical)?),
            Err(_) => {
                snapshot.path = None;
                snapshot.revision = None;
                snapshot.saved_source = None;
            }
        }
    }
    let directory = recovery_directory(&app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Wiederherstellungsordner kann nicht erstellt werden: {error}"))?;
    let bytes = serde_json::to_vec(&snapshot)
        .map_err(|error| format!("Wiederherstellung kann nicht serialisiert werden: {error}"))?;
    atomic_write_new(&recovery_file(&directory, &snapshot.id), &bytes)
}

#[tauri::command]
pub fn delete_recovery_snapshot(app: AppHandle, id: String) -> Result<(), String> {
    let path = recovery_file(&recovery_directory(&app)?, &id);
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Wiederherstellung kann nicht gelöscht werden: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn search_workspace(
    root: String,
    query: String,
    options: WorkspaceSearchOptions,
    overrides: Vec<WorkspaceSearchOverride>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSearchResponse, String> {
    let root = state.ensure_directory_access(Path::new(&root))?;
    if query.is_empty() {
        return Ok(WorkspaceSearchResponse::default());
    }
    let mut current_sources = HashMap::new();
    for item in overrides {
        let path = state.ensure_document_access(Path::new(&item.path))?;
        if !path.starts_with(&root) || !is_markdown(&path) {
            return Err("Ein Such-Override liegt außerhalb des Arbeitsordners".into());
        }
        current_sources.insert(path, item.source);
    }

    tauri::async_runtime::spawn_blocking(move || {
        search_workspace_files(root, query, options, current_sources)
    })
    .await
    .map_err(|error| format!("Arbeitsordnersuche wurde abgebrochen: {error}"))?
}

fn search_workspace_files(
    root: PathBuf,
    query: String,
    options: WorkspaceSearchOptions,
    mut current_sources: HashMap<PathBuf, String>,
) -> Result<WorkspaceSearchResponse, String> {
    let matcher = RegexBuilder::new(&regex::escape(&query))
        .case_insensitive(!options.case_sensitive)
        .unicode(true)
        .build()
        .map_err(|error| format!("Suchbegriff ist ungültig: {error}"))?;

    let mut files = Vec::new();
    collect_workspace_markdown(&root, &root, &mut files)?;
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let mut response = WorkspaceSearchResponse::default();

    for file in files {
        if response.hits.len() >= MAX_SEARCH_HITS_TOTAL {
            response.truncated = true;
            break;
        }
        let path = PathBuf::from(&file.path);
        let source = if let Some(source) = current_sources.remove(&path) {
            if source.len() as u64 > MAX_SEARCH_FILE_BYTES {
                response.skipped_large += 1;
                continue;
            }
            source
        } else {
            let metadata = match fs::metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.len() > MAX_SEARCH_FILE_BYTES {
                response.skipped_large += 1;
                continue;
            }
            let bytes = match fs::read(&path) {
                Ok(bytes) => bytes,
                Err(_) => continue,
            };
            match String::from_utf8(bytes) {
                Ok(source) => source,
                Err(_) => {
                    response.skipped_invalid_utf8 += 1;
                    continue;
                }
            }
        };

        let mut file_hits = 0;
        for matched in matcher.find_iter(&source) {
            if options.whole_word && !has_word_boundaries(&source, matched.start(), matched.end()) {
                continue;
            }
            if file_hits >= MAX_SEARCH_HITS_PER_FILE || response.hits.len() >= MAX_SEARCH_HITS_TOTAL
            {
                response.truncated = true;
                break;
            }
            let line_start = source[..matched.start()]
                .rfind('\n')
                .map_or(0, |index| index + 1);
            let line_end = source[matched.end()..]
                .find('\n')
                .map_or(source.len(), |index| matched.end() + index);
            let line = source[..matched.start()]
                .bytes()
                .filter(|byte| *byte == b'\n')
                .count()
                + 1;
            let column = source[line_start..matched.start()].encode_utf16().count() + 1;
            response.hits.push(WorkspaceSearchHit {
                path: file.path.clone(),
                name: file.name.clone(),
                relative_path: file.relative_path.clone(),
                line,
                column,
                from: utf16_offset(&source, matched.start()),
                to: utf16_offset(&source, matched.end()),
                context: source[line_start..line_end].trim().replace('\t', " "),
            });
            file_hits += 1;
        }
    }
    Ok(response)
}

#[tauri::command]
pub fn load_settings(app: AppHandle, state: State<'_, AppState>) -> Result<AppSettings, String> {
    let path = settings_file(&app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let bytes = fs::read(&path)
        .map_err(|error| format!("Einstellungen können nicht gelesen werden: {error}"))?;
    let settings = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Einstellungen sind beschädigt: {error}"))?;
    Ok(clean_settings(settings, &state, true))
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    let settings = clean_settings(settings, &state, false);
    let path = settings_file(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Einstellungsordner kann nicht erstellt werden: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(&settings)
        .map_err(|error| format!("Einstellungen können nicht serialisiert werden: {error}"))?;
    atomic_write_new(&path, &bytes)?;
    Ok(settings)
}

#[tauri::command]
pub async fn choose_preview_css(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<PreviewCssPayload>, String> {
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Eigene Vorschau-CSS auswählen")
        .add_filter("CSS", &["css"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|error| format!("CSS-Pfad ist ungültig: {error}"))?;
    if !has_extension(&path, &["css"]) {
        return Err("Die ausgewählte Datei muss die Erweiterung .css haben".into());
    }
    let path = state.authorize_preview_css(&path)?;
    read_preview_css_path(&path).map(Some)
}

#[tauri::command]
pub fn read_preview_css(
    path: String,
    state: State<'_, AppState>,
) -> Result<PreviewCssPayload, String> {
    let path = state.ensure_preview_css_access(Path::new(&path))?;
    read_preview_css_path(&path)
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

fn collect_workspace_markdown(
    root: &Path,
    directory: &Path,
    files: &mut Vec<WorkspaceFile>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Ordner kann nicht gelesen werden: {error}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_workspace_markdown(root, &path, files)?;
        } else if file_type.is_file() && is_markdown(&path) {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "Relativer Dateipfad konnte nicht ermittelt werden".to_string())?;
            files.push(WorkspaceFile {
                path: path_string(&path)?,
                name,
                relative_path: path_string(relative)?,
            });
        }
    }
    Ok(())
}

fn write_asset(
    document_path: &str,
    original_name: &str,
    bytes: &[u8],
    state: &AppState,
) -> Result<ImportedAsset, String> {
    let document = state.ensure_document_access(Path::new(document_path))?;
    let parent = document
        .parent()
        .ok_or_else(|| "Dokumentordner ist ungültig".to_string())?;
    let asset_directory = parent.join("assets");
    if asset_directory.exists() {
        let metadata = fs::symlink_metadata(&asset_directory)
            .map_err(|error| format!("Asset-Ordner kann nicht geprüft werden: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Der assets-Ordner darf keine symbolische Verknüpfung sein".into());
        }
        if !metadata.is_dir() {
            return Err("assets existiert bereits, ist aber kein Ordner".into());
        }
    } else {
        fs::create_dir(&asset_directory)
            .map_err(|error| format!("assets-Ordner kann nicht erstellt werden: {error}"))?;
    }
    let canonical_assets = asset_directory
        .canonicalize()
        .map_err(|error| format!("assets-Ordner ist nicht verfügbar: {error}"))?;
    if !canonical_assets.starts_with(parent) {
        return Err("Asset-Ziel liegt außerhalb des Dokumentordners".into());
    }

    let extension = Path::new(original_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase)
        .filter(|extension| IMAGE_EXTENSIONS.contains(&extension.as_str()))
        .ok_or_else(|| "Dieses Bildformat wird nicht unterstützt".to_string())?;
    let stem = Path::new(original_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(sanitize_file_stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "bild".into());
    let (target, file_name) = available_asset_path(&canonical_assets, &stem, &extension);
    atomic_create(&target, bytes)?;
    Ok(ImportedAsset {
        relative_path: format!("assets/{}", percent_encode_component(&file_name)),
        display_name: stem,
    })
}

fn available_asset_path(directory: &Path, stem: &str, extension: &str) -> (PathBuf, String) {
    for suffix in 1_u32.. {
        let file_name = if suffix == 1 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{suffix}.{extension}")
        };
        let path = directory.join(&file_name);
        if !path.exists() {
            return (path, file_name);
        }
    }
    unreachable!()
}

fn sanitize_file_stem(value: &str) -> String {
    let mut output = String::new();
    let mut separator = false;
    for character in value.chars() {
        if character.is_alphanumeric() || matches!(character, '-' | '_') {
            output.push(character);
            separator = false;
        } else if !separator && !output.is_empty() {
            output.push('-');
            separator = true;
        }
    }
    output.trim_matches('-').to_string()
}

fn percent_encode_component(value: &str) -> String {
    let mut output = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(*byte as char);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

fn extension_for_clipboard_mime(mime_type: &str) -> Option<&'static str> {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/avif" => Some("avif"),
        _ => None,
    }
}

fn validate_image_size(size: u64) -> Result<(), String> {
    if size > MAX_IMAGE_BYTES {
        Err("Das Bild ist größer als 30 MB".into())
    } else {
        Ok(())
    }
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

fn atomic_create(path: &Path, bytes: &[u8]) -> Result<(), String> {
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
        .persist_noclobber(path)
        .map_err(|error| format!("Datei existiert bereits: {}", error.error))?;
    Ok(())
}

fn session_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("session.json"))
        .map_err(|error| format!("Sitzungspfad ist nicht verfügbar: {error}"))
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("settings.json"))
        .map_err(|error| format!("Einstellungspfad ist nicht verfügbar: {error}"))
}

fn recovery_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("recovery"))
        .map_err(|error| format!("Wiederherstellungspfad ist nicht verfügbar: {error}"))
}

fn recovery_file(directory: &Path, id: &str) -> PathBuf {
    directory.join(format!("{}.json", blake3::hash(id.as_bytes()).to_hex()))
}

fn recovery_is_stale(modified: SystemTime, now: SystemTime) -> bool {
    now.duration_since(modified)
        .is_ok_and(|age| age > RECOVERY_MAX_AGE)
}

fn clean_settings(
    mut settings: AppSettings,
    state: &AppState,
    restore_authorization: bool,
) -> AppSettings {
    settings.preview.font_size = settings.preview.font_size.clamp(12.0, 24.0);
    settings.preview.content_width = settings
        .preview
        .content_width
        .filter(|width| width.is_finite())
        .map(|width| width.clamp(520.0, 1200.0));
    settings.custom_css_path = settings.custom_css_path.and_then(|path| {
        let candidate = Path::new(&path);
        if !candidate.is_file() || !has_extension(candidate, &["css"]) {
            return None;
        }
        let authorized = if restore_authorization {
            state.authorize_preview_css(candidate)
        } else {
            state.ensure_preview_css_access(candidate)
        };
        authorized.ok().and_then(|path| path_string(&path).ok())
    });
    settings
}

fn read_preview_css_path(path: &Path) -> Result<PreviewCssPayload, String> {
    if !has_extension(path, &["css"]) {
        return Err("Die ausgewählte Datei muss die Erweiterung .css haben".into());
    }
    let metadata = fs::metadata(path)
        .map_err(|error| format!("CSS-Datei kann nicht geprüft werden: {error}"))?;
    if metadata.len() > MAX_PREVIEW_CSS_BYTES {
        return Err("Die CSS-Datei ist größer als 1 MiB".into());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("CSS-Datei kann nicht gelesen werden: {error}"))?;
    let source = String::from_utf8(bytes)
        .map_err(|_| "Die CSS-Datei ist nicht als UTF-8 gespeichert".to_string())?;
    validate_preview_css(&source)?;
    Ok(PreviewCssPayload {
        path: path_string(path)?,
        source,
        revision: revision_for_path(path)?,
    })
}

fn validate_preview_css(source: &str) -> Result<(), String> {
    let mut without_comments = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(start) = rest.find("/*") {
        without_comments.push_str(&rest[..start]);
        let after_start = &rest[start + 2..];
        let Some(end) = after_start.find("*/") else {
            return Err("Die CSS-Datei enthält einen nicht geschlossenen Kommentar".into());
        };
        rest = &after_start[end + 2..];
    }
    without_comments.push_str(rest);
    let compact = without_comments
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    if compact.contains("@import")
        || compact.contains("url(")
        || compact.contains("image-set(")
        || compact.contains("-webkit-image-set(")
        || compact.contains("src:")
        || compact.contains('\\')
    {
        return Err(
            "Die CSS-Datei darf keine Imports, URLs oder nachladenden Ressourcen enthalten".into(),
        );
    }
    Ok(())
}

fn utf16_offset(source: &str, byte_offset: usize) -> usize {
    source[..byte_offset].encode_utf16().count()
}

fn has_word_boundaries(source: &str, start: usize, end: usize) -> bool {
    let starts_with_word = source[start..end]
        .chars()
        .next()
        .is_some_and(is_word_character);
    let ends_with_word = source[start..end]
        .chars()
        .next_back()
        .is_some_and(is_word_character);
    let before_is_word = source[..start]
        .chars()
        .next_back()
        .is_some_and(is_word_character);
    let after_is_word = source[end..].chars().next().is_some_and(is_word_character);
    (!starts_with_word || !before_is_word) && (!ends_with_word || !after_is_word)
}

fn is_word_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
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

    let mut recent_seen = HashSet::new();
    session.recent_paths = session
        .recent_paths
        .into_iter()
        .filter_map(|path| Path::new(&path).canonicalize().ok())
        .filter(|path| path.is_file() && is_markdown(path))
        .filter_map(|path| path_string(&path).ok())
        .filter(|path| recent_seen.insert(path.clone()))
        .take(MAX_RECENT_PATHS)
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
    use std::fs;

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

    #[test]
    fn cleans_and_limits_recent_markdown_paths() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let markdown = directory.path().join("notiz.md");
        let text = directory.path().join("notiz.txt");
        fs::write(&markdown, "Marky").expect("markdown fixture");
        fs::write(&text, "Marky").expect("text fixture");

        let cleaned = clean_session(SessionState {
            recent_paths: vec![
                path_string(&markdown).expect("markdown path"),
                path_string(&markdown).expect("duplicate markdown path"),
                path_string(&text).expect("text path"),
                "/definitely/missing.md".into(),
            ],
            ..SessionState::default()
        });

        let canonical = markdown.canonicalize().expect("canonical markdown path");
        assert_eq!(cleaned.recent_paths, vec![path_string(&canonical).unwrap()]);
    }

    #[test]
    fn finds_workspace_markdown_without_hidden_entries() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let nested = directory.path().join("Kapitel");
        let hidden = directory.path().join(".intern");
        fs::create_dir(&nested).expect("nested directory");
        fs::create_dir(&hidden).expect("hidden directory");
        fs::write(directory.path().join("Start.md"), "Start").expect("root markdown");
        fs::write(nested.join("Text.markdown"), "Text").expect("nested markdown");
        fs::write(nested.join("Text.txt"), "Text").expect("other file");
        fs::write(hidden.join("Geheim.md"), "Geheim").expect("hidden markdown");

        let mut files = Vec::new();
        collect_workspace_markdown(directory.path(), directory.path(), &mut files)
            .expect("workspace scan");
        files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

        assert_eq!(
            files
                .iter()
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["Kapitel/Text.markdown", "Start.md"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn workspace_scan_does_not_follow_directory_symlinks() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temporary directory");
        let outside = tempfile::tempdir().expect("outside directory");
        fs::write(outside.path().join("Fremd.md"), "Fremd").expect("outside markdown");
        symlink(outside.path(), directory.path().join("Verknuepfung")).expect("directory symlink");

        let mut files = Vec::new();
        collect_workspace_markdown(directory.path(), directory.path(), &mut files)
            .expect("workspace scan");

        assert!(files.is_empty());
    }

    #[test]
    fn asset_names_are_sanitized_encoded_and_never_reused() {
        let directory = tempfile::tempdir().expect("temporary directory");
        fs::write(directory.path().join("mein-bild.png"), b"existing").expect("existing asset");

        assert_eq!(sanitize_file_stem("  mein bild!?  "), "mein-bild");
        assert_eq!(
            percent_encode_component("grünes bild.png"),
            "gr%C3%BCnes%20bild.png"
        );
        let (path, name) = available_asset_path(directory.path(), "mein-bild", "png");
        assert_eq!(name, "mein-bild-2.png");
        assert_eq!(path, directory.path().join(&name));
    }

    #[test]
    fn atomic_creation_does_not_overwrite_existing_files() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("notiz.md");
        fs::write(&path, "Vorher").expect("existing file");

        assert!(atomic_create(&path, b"Nachher").is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "Vorher");
    }

    #[test]
    fn clipboard_formats_are_restricted() {
        assert_eq!(extension_for_clipboard_mime("image/png"), Some("png"));
        assert_eq!(extension_for_clipboard_mime("IMAGE/JPEG"), Some("jpg"));
        assert_eq!(extension_for_clipboard_mime("image/svg+xml"), None);
        assert_eq!(extension_for_clipboard_mime("text/plain"), None);
    }

    #[test]
    fn image_size_limit_includes_exactly_thirty_megabytes() {
        assert!(validate_image_size(MAX_IMAGE_BYTES).is_ok());
        assert!(validate_image_size(MAX_IMAGE_BYTES + 1).is_err());
    }

    #[test]
    fn invalid_utf8_documents_are_rejected() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("notiz.md");
        fs::write(&path, [0xff, 0xfe]).expect("invalid UTF-8 fixture");

        assert!(read_document_from_path(&path).is_err());
    }

    #[test]
    fn atomic_writes_change_the_file_revision() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("notiz.md");
        fs::write(&path, "Vorher").expect("existing document");
        let before = revision_for_path(&path).expect("initial revision");

        atomic_write(&path, b"Nachher").expect("atomic write");
        let after = revision_for_path(&path).expect("updated revision");

        assert_ne!(before.hash, after.hash);
        assert_eq!(fs::read_to_string(path).unwrap(), "Nachher");
    }

    #[test]
    fn utf16_offsets_match_codemirror_positions() {
        let source = "😀 Hallo ä";
        let hello = source.find("Hallo").expect("hello position");
        let umlaut_end = source.len();

        assert_eq!(utf16_offset(source, hello), 3);
        assert_eq!(utf16_offset(source, umlaut_end), 10);
    }

    #[test]
    fn whole_word_boundaries_are_unicode_aware() {
        let source = "Marky MarkyPlus Über-Marky";
        let first = source.find("Marky").expect("first match");
        let embedded = source.find("MarkyPlus").expect("embedded match");
        let final_match = source.rfind("Marky").expect("final match");

        assert!(has_word_boundaries(source, first, first + "Marky".len()));
        assert!(!has_word_boundaries(
            source,
            embedded,
            embedded + "Marky".len()
        ));
        assert!(has_word_boundaries(
            source,
            final_match,
            final_match + "Marky".len()
        ));
    }

    #[test]
    fn workspace_search_uses_dirty_overrides_and_skips_unsafe_files() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let root = directory.path().canonicalize().expect("canonical root");
        let document = root.join("Notiz.md");
        fs::write(&document, "Gespeichert").expect("document fixture");
        fs::write(root.join("ungueltig.md"), [0xff, 0xfe]).expect("invalid fixture");
        fs::write(
            root.join("gross.md"),
            vec![b'x'; MAX_SEARCH_FILE_BYTES as usize + 1],
        )
        .expect("large fixture");
        let overrides = HashMap::from([(document.clone(), "😀 Marky marky MarkyPlus".to_string())]);

        let response = search_workspace_files(
            root,
            "marky".into(),
            WorkspaceSearchOptions {
                case_sensitive: false,
                whole_word: true,
            },
            overrides,
        )
        .expect("workspace search");

        assert_eq!(response.hits.len(), 2);
        assert_eq!(response.hits[0].from, 3);
        assert_eq!(response.skipped_invalid_utf8, 1);
        assert_eq!(response.skipped_large, 1);
    }

    #[test]
    fn preview_css_rejects_external_resources() {
        assert!(validate_preview_css("article { color: rebeccapurple; }").is_ok());
        assert!(validate_preview_css("@ IMPORT url('theme.css');").is_err());
        assert!(validate_preview_css("p { background: uRl(https://example.com/a.png) }").is_err());
        assert!(validate_preview_css("@font-face { sRc : local(test); }").is_err());
        assert!(validate_preview_css("p { background: u\\72l(https://example.com) }").is_err());
        assert!(validate_preview_css("/* url(hidden) */ p { color: red }").is_ok());
    }

    #[test]
    fn recovery_file_names_cannot_escape_the_recovery_directory() {
        let directory = Path::new("/tmp/marky-recovery");
        let path = recovery_file(directory, "../../settings.json");

        assert_eq!(path.parent(), Some(directory));
        assert_eq!(
            path.extension().and_then(|value| value.to_str()),
            Some("json")
        );
        assert!(!path.to_string_lossy().contains(".."));
    }

    #[test]
    fn recovery_expires_only_after_thirty_days() {
        let now = UNIX_EPOCH + Duration::from_secs(100 * 24 * 60 * 60);
        assert!(!recovery_is_stale(now - RECOVERY_MAX_AGE, now));
        assert!(recovery_is_stale(
            now - RECOVERY_MAX_AGE - Duration::from_secs(1),
            now
        ));
        assert!(!recovery_is_stale(now + Duration::from_secs(1), now));
    }

    #[test]
    fn settings_are_clamped_and_unknown_css_is_removed() {
        let state = AppState::default();
        let cleaned = clean_settings(
            AppSettings {
                preview: crate::models::PreviewSettings {
                    font_size: 100.0,
                    content_width: Some(20.0),
                    ..Default::default()
                },
                custom_css_path: Some("/definitely/missing.css".into()),
            },
            &state,
            false,
        );

        assert_eq!(cleaned.preview.font_size, 24.0);
        assert_eq!(cleaned.preview.content_width, Some(520.0));
        assert!(cleaned.custom_css_path.is_none());
    }
}
