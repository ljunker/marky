mod commands;
mod models;
mod state;

use std::path::PathBuf;

use commands::{is_image, is_markdown};
use models::ImageDropPayload;
use state::AppState;
use tauri::{
    DragDropEvent, Emitter, Manager, WindowEvent,
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
};

fn install_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let new_file = MenuItemBuilder::with_id("new-file", "Neue Datei")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_file = MenuItemBuilder::with_id("open-file", "Datei öffnen …")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let open_folder = MenuItemBuilder::with_id("open-folder", "Ordner öffnen …")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let save = MenuItemBuilder::with_id("save", "Speichern")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id("save-as", "Speichern unter …")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let quick_open = MenuItemBuilder::with_id("quick-open", "Schnell öffnen …")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let find = MenuItemBuilder::with_id("find", "Suchen …")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let toggle_sidebar = MenuItemBuilder::with_id("toggle-sidebar", "Sidebar ein-/ausblenden")
        .accelerator("CmdOrCtrl+Alt+S")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "Marky")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "Ablage")
        .item(&new_file)
        .separator()
        .items(&[&open_file, &open_folder, &quick_open])
        .separator()
        .item(&save)
        .item(&save_as)
        .separator()
        .close_window()
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Bearbeiten")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "Darstellung")
        .item(&toggle_sidebar)
        .separator()
        .fullscreen()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Fenster")
        .minimize()
        .bring_all_to_front()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let identifier = event.id().as_ref();
        if matches!(
            identifier,
            "new-file"
                | "open-file"
                | "open-folder"
                | "quick-open"
                | "save"
                | "save-as"
                | "find"
                | "toggle-sidebar"
        ) {
            let _ = app.emit("menu-action", identifier);
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            app.state::<AppState>()
                .initialize_watcher(app.handle().clone())
                .map_err(std::io::Error::other)?;
            install_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::authorize_document,
            commands::cancel_document_save_path,
            commands::cancel_image_drop,
            commands::choose_markdown_files,
            commands::choose_workspace,
            commands::choose_document_save_path,
            commands::drain_open_paths,
            commands::import_image_file,
            commands::list_directory,
            commands::list_workspace_markdown,
            commands::load_session,
            commands::read_document,
            commands::read_local_asset,
            commands::save_document,
            commands::save_document_as,
            commands::save_image_bytes,
            commands::save_session,
        ])
        .build(tauri::generate_context!())
        .expect("Marky konnte nicht gestartet werden");

    application.run(|app, event| match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: WindowEvent::DragDrop(DragDropEvent::Drop { paths, position }),
            ..
        } if label == "main" => {
            let image_paths = paths
                .into_iter()
                .filter(|path| is_image(path))
                .collect::<Vec<_>>();
            let accepted = app
                .state::<AppState>()
                .authorize_dropped_files(&image_paths);
            if accepted.is_empty() {
                return;
            }
            let scale_factor = app
                .get_webview_window("main")
                .and_then(|window| window.scale_factor().ok())
                .unwrap_or(1.0);
            let logical = position.to_logical::<f64>(scale_factor);
            let payload = ImageDropPayload {
                paths: accepted
                    .iter()
                    .filter_map(|path| path.to_str().map(ToOwned::to_owned))
                    .collect(),
                x: logical.x,
                y: logical.y,
            };
            let _ = app.emit("image-drop", payload);
        }
        tauri::RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| is_markdown(path))
                .collect::<Vec<PathBuf>>();
            if paths.is_empty() {
                return;
            }
            app.state::<AppState>().queue_open_paths(paths.clone());
            let display_paths = paths
                .into_iter()
                .filter_map(|path| path.to_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>();
            let _ = app.emit("open-paths", display_paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        tauri::RunEvent::Reopen { .. } => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {}
    });
}
