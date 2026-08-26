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
    preview_css_files: HashSet<PathBuf>,
    pending_save_targets: HashSet<PathBuf>,
    pending_drop_files: HashSet<PathBuf>,
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

    pub fn authorize_preview_css(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("CSS-Datei kann nicht geöffnet werden: {error}"))?;
        if !canonical.is_file() {
            return Err("Der ausgewählte Pfad ist keine CSS-Datei".into());
        }

        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?;
        inner.preview_css_files.insert(canonical.clone());
        if let Some(parent) = canonical.parent() {
            watch_path(&mut inner, parent, RecursiveMode::NonRecursive)?;
        }
        Ok(canonical)
    }

    pub fn ensure_preview_css_access(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("CSS-Datei ist nicht verfügbar: {error}"))?;
        let inner = self
            .inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?;
        if inner.preview_css_files.contains(&canonical) {
            Ok(canonical)
        } else {
            Err("Zugriff auf diese CSS-Datei wurde nicht freigegeben".into())
        }
    }

    pub fn authorize_save_target(&self, path: &Path) -> Result<PathBuf, String> {
        let normalized = normalize_target(path)?;
        self.inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?
            .pending_save_targets
            .insert(normalized.clone());
        Ok(normalized)
    }

    pub fn consume_save_target(&self, path: &Path) -> Result<PathBuf, String> {
        let normalized = normalize_target(path)?;
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?;
        if inner.pending_save_targets.remove(&normalized) {
            Ok(normalized)
        } else {
            Err("Dieser Speicherort wurde nicht über den Speichern-Dialog freigegeben".into())
        }
    }

    pub fn revoke_save_target(&self, path: &Path) -> Result<(), String> {
        let normalized = normalize_target(path)?;
        self.inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?
            .pending_save_targets
            .remove(&normalized);
        Ok(())
    }

    pub fn authorize_dropped_files(&self, paths: &[PathBuf]) -> Vec<PathBuf> {
        let accepted = paths
            .iter()
            .filter_map(|path| path.canonicalize().ok())
            .filter(|path| path.is_file())
            .collect::<Vec<_>>();
        if let Ok(mut inner) = self.inner.lock() {
            inner.pending_drop_files.extend(accepted.iter().cloned());
        }
        accepted
    }

    pub fn consume_dropped_file(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("Bilddatei ist nicht verfügbar: {error}"))?;
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?;
        if inner.pending_drop_files.remove(&canonical) {
            Ok(canonical)
        } else {
            Err("Diese Bilddatei wurde nicht per Drag-and-drop freigegeben".into())
        }
    }

    pub fn revoke_dropped_files(&self, paths: &[PathBuf]) -> Result<(), String> {
        let canonical = paths
            .iter()
            .filter_map(|path| path.canonicalize().ok())
            .collect::<Vec<_>>();
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Interner Zustand ist gesperrt".to_string())?;
        for path in canonical {
            inner.pending_drop_files.remove(&path);
        }
        Ok(())
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

fn normalize_target(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "Der Dateiname ist ungültig".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "Der Speicherort hat keinen übergeordneten Ordner".to_string())?
        .canonicalize()
        .map_err(|error| format!("Speicherordner ist nicht verfügbar: {error}"))?;
    if !parent.is_dir() {
        return Err("Der ausgewählte Speicherort ist kein Ordner".into());
    }
    let candidate = parent.join(file_name);
    if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|error| format!("Dateipfad ist ungültig: {error}"))
    } else {
        Ok(candidate)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_targets_must_be_authorized_and_are_consumed_once() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let target = directory.path().join("notiz.md");
        let state = AppState::default();

        state
            .authorize_save_target(&target)
            .expect("target authorization");
        let expected = directory
            .path()
            .canonicalize()
            .expect("canonical temporary directory")
            .join("notiz.md");
        assert_eq!(
            state.consume_save_target(&target).expect("first consume"),
            expected
        );
        assert!(state.consume_save_target(&target).is_err());
    }

    #[test]
    fn revoked_save_targets_cannot_be_consumed() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let target = directory.path().join("notiz.md");
        let state = AppState::default();

        state
            .authorize_save_target(&target)
            .expect("target authorization");
        state.revoke_save_target(&target).expect("target revoke");

        assert!(state.consume_save_target(&target).is_err());
    }

    #[test]
    fn dropped_files_are_authorized_once() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let image = directory.path().join("bild.png");
        std::fs::write(&image, b"image").expect("image fixture");
        let state = AppState::default();

        assert_eq!(
            state
                .authorize_dropped_files(std::slice::from_ref(&image))
                .len(),
            1
        );
        assert!(state.consume_dropped_file(&image).is_ok());
        assert!(state.consume_dropped_file(&image).is_err());
    }

    #[test]
    fn revoked_drop_files_cannot_be_consumed() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let image = directory.path().join("bild.png");
        std::fs::write(&image, b"image").expect("image fixture");
        let state = AppState::default();

        state.authorize_dropped_files(std::slice::from_ref(&image));
        state
            .revoke_dropped_files(std::slice::from_ref(&image))
            .expect("drop revoke");

        assert!(state.consume_dropped_file(&image).is_err());
    }

    #[test]
    fn standalone_assets_cannot_traverse_outside_the_document_folder() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let document_directory = directory.path().join("docs");
        let outside_directory = directory.path().join("outside");
        std::fs::create_dir(&document_directory).expect("document directory");
        std::fs::create_dir(&outside_directory).expect("outside directory");
        let document = document_directory.join("notiz.md");
        let outside_image = outside_directory.join("bild.png");
        std::fs::write(&document, "Marky").expect("document fixture");
        std::fs::write(&outside_image, b"image").expect("outside image fixture");
        let canonical_document = document.canonicalize().expect("canonical document");
        let state = AppState::default();
        state
            .inner
            .lock()
            .expect("state lock")
            .standalone_files
            .insert(canonical_document);

        assert!(
            state
                .ensure_asset_access(&document, Path::new("../outside/bild.png"))
                .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn standalone_assets_cannot_escape_through_symlinks() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temporary directory");
        let document_directory = directory.path().join("docs");
        let outside_directory = directory.path().join("outside");
        std::fs::create_dir(&document_directory).expect("document directory");
        std::fs::create_dir(&outside_directory).expect("outside directory");
        let document = document_directory.join("notiz.md");
        std::fs::write(&document, "Marky").expect("document fixture");
        std::fs::write(outside_directory.join("bild.png"), b"image")
            .expect("outside image fixture");
        symlink(&outside_directory, document_directory.join("assets")).expect("assets symlink");
        let canonical_document = document.canonicalize().expect("canonical document");
        let state = AppState::default();
        state
            .inner
            .lock()
            .expect("state lock")
            .standalone_files
            .insert(canonical_document);

        assert!(
            state
                .ensure_asset_access(&document, Path::new("assets/bild.png"))
                .is_err()
        );
    }
}
