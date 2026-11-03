mod commands;
mod credentials;
mod files;
mod forward;
mod history;
mod local;
mod logger;
mod ssh;
mod state;
mod utf8;

/// Gives the process the same AppUserModelID the NSIS installer stamps on its
/// Start menu / desktop shortcuts (the bundle identifier). Without it Windows
/// treats the pinned shortcut and the running window as two different apps and
/// shows two taskbar buttons. Must run before the first window is created.
///
/// Only done for installed copies (the installer puts `uninstall.exe` next to
/// the exe): a portable copy has no shortcut carrying that id, so it keeps the
/// default exe-path identity, which pins correctly on its own.
#[cfg(windows)]
fn set_app_user_model_id(identifier: &str) {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }

    let installed = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").is_file()))
        .unwrap_or(false);
    if !installed {
        return;
    }
    let id: Vec<u16> = std::ffi::OsStr::new(identifier).encode_wide().chain(Some(0)).collect();
    // SAFETY: `id` is a NUL-terminated UTF-16 string that outlives the call.
    unsafe {
        SetCurrentProcessExplicitAppUserModelID(id.as_ptr());
    }
}

pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(windows)]
    set_app_user_model_id(&context.config().identifier);

    tauri::Builder::default()
        .manage(state::TerminalManager::default())
        .manage(logger::LogManager::default())
        .manage(files::SftpManager::default())
        .manage(files::TransferManager::default())
        .manage(files::EditManager::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_shells,
            commands::open_local_terminal,
            commands::open_ssh_terminal,
            commands::write_terminal,
            commands::write_terminal_bytes,
            commands::resize_terminal,
            commands::close_terminal,
            commands::start_session_log,
            commands::default_log_dir,
            commands::open_log_folder,
            files::fs_home,
            files::fs_list,
            files::fs_parent,
            files::fs_create,
            files::fs_rename,
            files::fs_delete,
            files::fs_transfer,
            files::fs_cancel_transfer,
            files::fs_edit_remote,
            files::fs_stop_edit,
            credentials::credential_set,
            credentials::credential_delete,
            credentials::credential_copy,
            history::history_save_snapshot,
            history::history_load_snapshot,
            history::history_delete_snapshots,
            files::fs_open,
            files::fs_reveal,
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            // Make sure every PTY child / SSH connection is torn down on exit.
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                app.state::<state::TerminalManager>().close_all();
                app.state::<logger::LogManager>().stop_all();
            }
        });
}
