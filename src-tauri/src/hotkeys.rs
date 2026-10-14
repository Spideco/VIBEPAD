//! Atalhos globais. O plugin executa o registro na thread principal e o handler
//! também roda nela, então nunca seguramos `library`/`map` enquanto registramos;
//! senão um atalho disparado durante o registro causaria deadlock.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::{audio::AudioCommand, commands, AppState};

/// Chave usada em `failures` para o atalho de "parar tudo".
pub const STOP_KEY: &str = "__stop__";

#[derive(Clone)]
pub enum HotkeyAction {
    Play(String),
    StopAll,
}

#[derive(Default)]
pub struct HotkeyRegistry {
    pub map: Mutex<HashMap<u32, HotkeyAction>>,
    pub failures: Mutex<HashMap<String, String>>,
    pub suspended: AtomicBool,
    rebuild_lock: Mutex<()>,
}

pub fn parse(hotkey: &str) -> Result<Shortcut, String> {
    hotkey
        .parse::<Shortcut>()
        .map_err(|e| format!("Atalho inválido \"{hotkey}\": {e}"))
}

/// O mesmo atalho escrito de formas diferentes ("ctrl+a" / "Ctrl+A") gera o mesmo id.
pub fn same(a: &str, b: &str) -> bool {
    match (parse(a), parse(b)) {
        (Ok(a), Ok(b)) => a.id() == b.id(),
        _ => a.eq_ignore_ascii_case(b),
    }
}

/// Re-registra todos os atalhos a partir da biblioteca. Retorna as falhas por id de som.
pub fn rebuild(app: &AppHandle) -> HashMap<String, String> {
    let state = app.state::<AppState>();
    let _guard = state.hotkeys.rebuild_lock.lock().unwrap();

    let entries: Vec<(String, HotkeyAction, String)> = {
        let lib = state.library.lock().unwrap();
        let stop = lib
            .settings
            .stop_hotkey
            .clone()
            .map(|hk| (STOP_KEY.to_string(), HotkeyAction::StopAll, hk));
        let sounds = lib.sounds.iter().filter_map(|s| {
            s.hotkey
                .clone()
                .map(|hk| (s.id.clone(), HotkeyAction::Play(s.id.clone()), hk))
        });
        stop.into_iter().chain(sounds).collect()
    };

    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let mut map = HashMap::new();
    let mut failures = HashMap::new();
    if !state.hotkeys.suspended.load(Ordering::SeqCst) {
        for (key, action, hotkey) in entries {
            let shortcut = match parse(&hotkey) {
                Ok(s) => s,
                Err(e) => {
                    failures.insert(key, e);
                    continue;
                }
            };
            let id = shortcut.id();
            if map.contains_key(&id) {
                failures.insert(key, format!("{hotkey} já está em uso por outro som"));
                continue;
            }
            match gs.register(shortcut) {
                Ok(()) => {
                    map.insert(id, action);
                }
                Err(e) => {
                    failures.insert(
                        key,
                        format!("Não foi possível registrar {hotkey} (talvez esteja reservado por outro programa): {e}"),
                    );
                }
            }
        }
    }

    *state.hotkeys.map.lock().unwrap() = map;
    *state.hotkeys.failures.lock().unwrap() = failures.clone();
    failures
}

pub fn handle(app: &AppHandle, shortcut_id: u32) {
    let state = app.state::<AppState>();
    let action = state.hotkeys.map.lock().unwrap().get(&shortcut_id).cloned();
    match action {
        Some(HotkeyAction::Play(sound_id)) => {
            if let Err(e) = commands::play(&state, &sound_id) {
                let _ = app.emit("audio-error", e);
            }
        }
        Some(HotkeyAction::StopAll) => state.audio.send(AudioCommand::StopAll),
        None => {}
    }
}
