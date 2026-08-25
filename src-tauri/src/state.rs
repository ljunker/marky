use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter};

use crate::models::FileSystemChange;

#[derive(Default)]
struct AccessState {
    authorized_roots: HashSet<PathBuf>,
    standalone_files: HashSet<PathBuf>,
    pending_open_paths: Vec<PathBuf>,
    watched_paths: HashSet<PathBuf>,
    watcher: Option<RecommendedWatcher>,
}

#[derive(Default)]
pub struct AppState {
    inner: Mutex<AccessState>,
}

impl AppState {
    pub fn initialize_watcher(&self, app: AppHandle) -> Result<(), String> {
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event {
                let paths = event
                    .paths
                    .into_iter()
                    .filter_map(|path| path.to_str().map(ToOwned::to_owned))
                    .collect::<Vec<_>>();

                if !paths.is_empty() {
                    let _ = app.emit("file-system-change", FileSystemChange { paths });
                }
            }
        })
        .map_err(|error| format!("Dateiüberwachung konnte nicht gestartet werden: {error}"))?;

        self.inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?
            .watcher = Some(watcher);
        Ok(())
    }

    pub fn authorize_root(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("Ordner kann nicht geöffnet werden: {error}"))?;
        if !canonical.is_dir() {
            return Err("Der ausgewählte Pfad ist kein Ordner".into());
        }

        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?;
        inner.authorized_roots.insert(canonical.clone());
        watch_path(&mut inner, &canonical, RecursiveMode::Recursive)?;
        Ok(canonical)
    }

    pub fn authorize_file(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("Datei kann nicht geöffnet werden: {error}"))?;
        if !canonical.is_file() {
            return Err("Der ausgewählte Pfad ist keine Datei".into());
        }

        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?;
        inner.standalone_files.insert(canonical.clone());
        if let Some(parent) = canonical.parent() {
            watch_path(&mut inner, parent, RecursiveMode::NonRecursive)?;
        }
        Ok(canonical)
    }

    pub fn ensure_document_access(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("Datei ist nicht verfügbar: {error}"))?;
        let inner = self
            .inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?;

        if inner.standalone_files.contains(&canonical)
            || inner
                .authorized_roots
                .iter()
                .any(|root| canonical.starts_with(root))
        {
            Ok(canonical)
        } else {
            Err("Zugriff auf diese Datei wurde nicht freigegeben".into())
        }
    }

    pub fn ensure_directory_access(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("Ordner ist nicht verfügbar: {error}"))?;
        let inner = self
            .inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?;

        if inner
            .authorized_roots
            .iter()
            .any(|root| canonical == *root || canonical.starts_with(root))
        {
            Ok(canonical)
        } else {
            Err("Zugriff auf diesen Ordner wurde nicht freigegeben".into())
        }
    }

    pub fn ensure_asset_access(
        &self,
        document_path: &Path,
        asset_path: &Path,
    ) -> Result<PathBuf, String> {
        let document = self.ensure_document_access(document_path)?;
        let parent = document
            .parent()
            .ok_or_else(|| "Dokumentordner ist ungültig".to_string())?;
        let candidate = parent.join(asset_path);
        let canonical = candidate
            .canonicalize()
            .map_err(|error| format!("Bild ist nicht verfügbar: {error}"))?;

        let inner = self
            .inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?;
        let inside_root = inner
            .authorized_roots
            .iter()
            .any(|root| canonical.starts_with(root));
        let standalone_neighbor =
            inner.standalone_files.contains(&document) && canonical.starts_with(parent);

        if (inside_root || standalone_neighbor) && canonical.is_file() {
            Ok(canonical)
        } else {
            Err("Das Bild liegt außerhalb des freigegebenen Bereichs".into())
        }
    }

    pub fn queue_open_paths(&self, paths: Vec<PathBuf>) {
        if let Ok(mut inner) = self.inner.lock() {
            for path in paths {
                if !inner.pending_open_paths.contains(&path) {
                    inner.pending_open_paths.push(path);
                }
            }
        }
    }

    pub fn drain_open_paths(&self) -> Vec<PathBuf> {
        self.inner
            .lock()
            .map(|mut inner| std::mem::take(&mut inner.pending_open_paths))
            .unwrap_or_default()
    }
}

fn watch_path(
    inner: &mut AccessState,
    path: &Path,
    recursive_mode: RecursiveMode,
) -> Result<(), String> {
    if inner.watched_paths.contains(path) {
        return Ok(());
    }
    let watcher = inner
        .watcher
        .as_mut()
        .ok_or_else(|| "Dateiüberwachung ist noch nicht bereit".to_string())?;
    watcher
        .watch(path, recursive_mode)
        .map_err(|error| format!("Pfad kann nicht überwacht werden: {error}"))?;
    inner.watched_paths.insert(path.to_path_buf());
    Ok(())
}
