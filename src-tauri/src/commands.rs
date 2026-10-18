use std::{collections::HashMap, path::PathBuf, sync::atomic::Ordering, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{
    audio::{self, AudioCommand, DeviceInfo},
    hotkeys::{self, STOP_KEY},
    library::{Library, Settings, Sound},
    mic_native::FeedStatus,
    mic_setup::{self, CaptureDevice},
    waveform, AppState,
};

type CmdResult<T> = Result<T, String>;

const WAVEFORM_BARS: usize = 120;
const SUPPORTED: &[&str] = &["mp3", "wav", "ogg", "flac", "m4a", "aac", "mp4"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    sounds: Vec<Sound>,
    settings: Settings,
    hotkey_errors: HashMap<String, String>,
}

fn snapshot(state: &AppState) -> Snapshot {
    let lib = state.library.lock().unwrap();
    Snapshot {
        sounds: lib.sounds.clone(),
        settings: lib.settings.clone(),
        hotkey_errors: state.hotkeys.failures.lock().unwrap().clone(),
    }
}

fn persist(state: &AppState, lib: &Library) {
    if let Err(e) = lib.save(&state.data_file) {
        eprintln!("falha ao salvar a biblioteca: {e}");
    }
}

/// Executa `hotkeys::rebuild` fora do runtime async, pois ele bloqueia
/// esperando a thread principal.
async fn rebuild_hotkeys(app: &AppHandle) -> HashMap<String, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || hotkeys::rebuild(&app))
        .await
        .unwrap_or_default()
}

pub fn play(state: &AppState, id: &str, start: Duration) -> CmdResult<()> {
    let (path, volume, exclusive) = {
        let lib = state.library.lock().unwrap();
        let sound = lib.sound(id).ok_or("Som não encontrado")?;
        (PathBuf::from(&sound.path), sound.volume, !lib.settings.allow_overlap)
    };
    state.audio.send(AudioCommand::Play { sound_id: id.to_string(), path, volume, exclusive, start });
    Ok(())
}

#[tauri::command]
pub async fn get_state(app: AppHandle) -> CmdResult<Snapshot> {
    Ok(snapshot(&app.state::<AppState>()))
}

#[tauri::command]
pub async fn list_output_devices() -> CmdResult<Vec<DeviceInfo>> {
    tauri::async_runtime::spawn_blocking(audio::list_output_devices)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_sounds(app: AppHandle, paths: Vec<String>) -> CmdResult<Vec<Sound>> {
    let existing: Vec<String> = {
        let state = app.state::<AppState>();
        let lib = state.library.lock().unwrap();
        lib.sounds.iter().map(|s| s.path.clone()).collect()
    };
    let candidates: Vec<PathBuf> = paths
        .into_iter()
        .filter(|p| !existing.contains(p))
        .map(PathBuf::from)
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| SUPPORTED.contains(&e.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect();
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let (added, errors) = tauri::async_runtime::spawn_blocking(move || {
        let mut added = Vec::new();
        let mut errors = Vec::new();
        for path in candidates {
            match waveform::analyze(&path, WAVEFORM_BARS) {
                Ok(analysis) => added.push(Sound {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Som")
                        .to_string(),
                    path: path.to_string_lossy().into_owned(),
                    hotkey: None,
                    volume: 1.0,
                    favorite: false,
                    duration_ms: analysis.duration_ms,
                    peaks: analysis.peaks,
                }),
                Err(e) => errors.push(e),
            }
        }
        (added, errors)
    })
    .await
    .map_err(|e| e.to_string())?;

    if added.is_empty() && !errors.is_empty() {
        return Err(errors.join("\n"));
    }
    let state = app.state::<AppState>();
    let mut lib = state.library.lock().unwrap();
    lib.sounds.extend(added.iter().cloned());
    persist(&state, &lib);
    Ok(added)
}

#[tauri::command]
pub async fn remove_sound(app: AppHandle, id: String) -> CmdResult<()> {
    let had_hotkey = {
        let state = app.state::<AppState>();
        state.audio.send(AudioCommand::Stop(id.clone()));
        let mut lib = state.library.lock().unwrap();
        let had = lib.sound(&id).map(|s| s.hotkey.is_some()).unwrap_or(false);
        lib.sounds.retain(|s| s.id != id);
        persist(&state, &lib);
        had
    };
    if had_hotkey {
        rebuild_hotkeys(&app).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn update_sound(
    app: AppHandle,
    id: String,
    name: Option<String>,
    volume: Option<f32>,
    favorite: Option<bool>,
) -> CmdResult<Sound> {
    let state = app.state::<AppState>();
    let mut lib = state.library.lock().unwrap();
    let sound = lib.sound_mut(&id).ok_or("Som não encontrado")?;
    if let Some(name) = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) {
        sound.name = name;
    }
    if let Some(volume) = volume {
        sound.volume = volume.clamp(0.0, 1.5);
    }
    if let Some(favorite) = favorite {
        sound.favorite = favorite;
    }
    let updated = sound.clone();
    persist(&state, &lib);
    Ok(updated)
}

/// Define (ou remove, com `None`) o atalho de um som. Se outro som usava a mesma
/// combinação, ela é transferida para este.
#[tauri::command]
pub async fn set_hotkey(app: AppHandle, id: String, hotkey: Option<String>) -> CmdResult<Snapshot> {
    let previous = {
        let state = app.state::<AppState>();
        let mut lib = state.library.lock().unwrap();
        if let Some(hk) = &hotkey {
            hotkeys::parse(hk)?;
            if lib.settings.stop_hotkey.as_deref().is_some_and(|s| hotkeys::same(s, hk)) {
                return Err(format!("{hk} já é o atalho de \"Parar tudo\""));
            }
        }
        let previous: Vec<(String, Option<String>)> =
            lib.sounds.iter().map(|s| (s.id.clone(), s.hotkey.clone())).collect();
        for sound in lib.sounds.iter_mut() {
            if sound.id == id {
                sound.hotkey = hotkey.clone();
            } else if let (Some(theirs), Some(ours)) = (&sound.hotkey, &hotkey) {
                if hotkeys::same(theirs, ours) {
                    sound.hotkey = None;
                }
            }
        }
        previous
    };

    let failures = rebuild_hotkeys(&app).await;
    let state = app.state::<AppState>();
    if let Some(err) = failures.get(&id).filter(|_| hotkey.is_some()).cloned() {
        {
            let mut lib = state.library.lock().unwrap();
            for (sid, hk) in previous {
                if let Some(s) = lib.sound_mut(&sid) {
                    s.hotkey = hk;
                }
            }
        }
        rebuild_hotkeys(&app).await;
        return Err(err);
    }
    persist(&state, &state.library.lock().unwrap());
    Ok(snapshot(&state))
}

#[tauri::command]
pub async fn update_settings(app: AppHandle, settings: Settings) -> CmdResult<Snapshot> {
    let hotkey_changed = {
        let state = app.state::<AppState>();
        let mut lib = state.library.lock().unwrap();
        if let Some(hk) = &settings.stop_hotkey {
            hotkeys::parse(hk)?;
            if let Some(s) = lib
                .sounds
                .iter()
                .find(|s| s.hotkey.as_deref().is_some_and(|h| hotkeys::same(h, hk)))
            {
                return Err(format!("{hk} já é usado por \"{}\"", s.name));
            }
        }
        let changed = lib.settings.stop_hotkey != settings.stop_hotkey;
        lib.settings = Settings {
            master_volume: settings.master_volume.clamp(0.0, 1.0),
            monitor_volume: settings.monitor_volume.clamp(0.0, 1.0),
            ..settings
        };
        state.audio.send(AudioCommand::Configure(lib.audio_config()));
        persist(&state, &lib);
        changed
    };
    if hotkey_changed {
        let failures = rebuild_hotkeys(&app).await;
        if let Some(err) = failures.get(STOP_KEY) {
            return Err(err.clone());
        }
    }
    Ok(snapshot(&app.state::<AppState>()))
}

#[tauri::command]
pub async fn play_sound(app: AppHandle, id: String, start_ms: Option<u64>) -> CmdResult<()> {
    let start = Duration::from_millis(start_ms.unwrap_or(0));
    play(&app.state::<AppState>(), &id, start)
}

#[tauri::command]
pub async fn stop_sound(app: AppHandle, id: String) -> CmdResult<()> {
    app.state::<AppState>().audio.send(AudioCommand::Stop(id));
    Ok(())
}

#[tauri::command]
pub async fn stop_all(app: AppHandle) -> CmdResult<()> {
    app.state::<AppState>().audio.send(AudioCommand::StopAll);
    Ok(())
}

// ---- Microfone nativo (APO) ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMicState {
    devices: Vec<CaptureDevice>,
    feed: FeedStatus,
    /// A DLL do APO foi encontrada (no pacote ou na pasta de build).
    dll_available: bool,
}

fn apo_dll_path(app: &AppHandle) -> Option<PathBuf> {
    let bundled = app.path().resource_dir().ok().map(|dir| dir.join("vibepad_mic.dll"));
    let dev = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../apo/target/release/vibepad_mic.dll"));
    bundled.filter(|p| p.exists()).or_else(|| dev.exists().then_some(dev))
}

#[tauri::command]
pub async fn native_mic_state(app: AppHandle) -> CmdResult<NativeMicState> {
    let devices = tauri::async_runtime::spawn_blocking(mic_setup::list_capture_devices)
        .await
        .map_err(|e| e.to_string())??;
    Ok(NativeMicState {
        devices,
        feed: app.state::<AppState>().audio.native_mic_status(),
        dll_available: apo_dll_path(&app).is_some(),
    })
}

/// Instala o APO no microfone `guid`. Abre o UAC: as alterações no registro e
/// o reinício do serviço de áudio rodam num processo elevado separado.
#[tauri::command]
pub async fn install_native_mic(app: AppHandle, guid: String) -> CmdResult<String> {
    let dll = apo_dll_path(&app).ok_or("Componente do microfone (vibepad_mic.dll) não encontrado. Rode \"npm run build:apo\".")?;
    tauri::async_runtime::spawn_blocking(move || mic_setup::run_elevated("install", &guid, Some(&dll)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn uninstall_native_mic(guid: String) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || mic_setup::run_elevated("uninstall", &guid, None))
        .await
        .map_err(|e| e.to_string())?
}

/// Suspende os atalhos globais enquanto o usuário grava uma nova combinação;
/// caso contrário o próprio sistema "engoliria" a tecla.
#[tauri::command]
pub async fn set_hotkeys_suspended(app: AppHandle, suspended: bool) -> CmdResult<Snapshot> {
    app.state::<AppState>().hotkeys.suspended.store(suspended, Ordering::SeqCst);
    rebuild_hotkeys(&app).await;
    Ok(snapshot(&app.state::<AppState>()))
}
