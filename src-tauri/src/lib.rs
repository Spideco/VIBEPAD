mod audio;
mod commands;
mod hotkeys;
mod library;
mod waveform;

use std::{fs, path::PathBuf, sync::Mutex};

use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState;

use audio::AudioEngine;
use hotkeys::HotkeyRegistry;
use library::Library;

pub struct AppState {
    pub library: Mutex<Library>,
    pub data_file: PathBuf,
    pub audio: AudioEngine,
    pub hotkeys: HotkeyRegistry,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        hotkeys::handle(app, shortcut.id());
                    }
                })
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let data_file = dir.join("library.json");
            let library = Library::load(&data_file);
            let audio = AudioEngine::spawn(app.handle().clone(), library.audio_config());

            app.manage(AppState {
                library: Mutex::new(library),
                data_file,
                audio,
                hotkeys: HotkeyRegistry::default(),
            });

            // O registro de atalhos despacha para a thread principal; fazê-lo fora
            // dela evita bloquear o setup.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                hotkeys::rebuild(&handle);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::list_output_devices,
            commands::add_sounds,
            commands::remove_sound,
            commands::update_sound,
            commands::set_hotkey,
            commands::update_settings,
            commands::play_sound,
            commands::stop_sound,
            commands::stop_all,
            commands::set_hotkeys_suspended,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o VibePad");
}
