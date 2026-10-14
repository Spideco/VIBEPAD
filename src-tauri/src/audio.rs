//! Motor de áudio: uma thread dedicada é dona dos `OutputStream`s (que não são
//! `Send`) e recebe comandos por canal. Cada som tocado vira uma "voz" com uma
//! saída por rota, permitindo tocar ao mesmo tempo no microfone e nos fones.
//! O microfone é alimentado pelo APO nativo (`mic_native`) ou por um cabo
//! virtual (ex.: VB-Audio "CABLE Input").

use std::{
    fs::File,
    io::BufReader,
    path::PathBuf,
    sync::mpsc::{self, RecvTimeoutError, Sender},
    thread,
    time::Duration,
};

use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::mic_native::{FeedHandle, FeedStatus, MicFeed};

/// Nomes (parciais) de dispositivos de saída que normalmente são microfones virtuais.
const VIRTUAL_MIC_HINTS: &[&str] = &["cable input", "voicemeeter input", "voicemeeter aux", "virtual"];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputMode {
    #[default]
    Both,
    MicOnly,
    MonitorOnly,
}

/// Como o som chega ao microfone.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MicBackend {
    /// APO do VibePad instalado no próprio microfone (como o Soundpad).
    #[default]
    Native,
    /// Dispositivo de saída de um cabo virtual.
    VirtualCable,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AudioConfig {
    pub mic_backend: MicBackend,
    pub block_mic: bool,
    pub mic_device: Option<String>,
    pub monitor_device: Option<String>,
    pub mode: OutputMode,
    pub master_volume: f32,
    pub monitor_volume: f32,
}

impl AudioConfig {
    fn same_devices(&self, other: &AudioConfig) -> bool {
        self.mic_backend == other.mic_backend
            && self.mic_device == other.mic_device
            && self.monitor_device == other.monitor_device
            && self.mode == other.mode
    }
}

pub enum AudioCommand {
    Play {
        sound_id: String,
        path: PathBuf,
        volume: f32,
        exclusive: bool,
    },
    Stop(String),
    StopAll,
    Configure(AudioConfig),
}

#[derive(Clone)]
pub struct AudioEngine {
    tx: Sender<AudioCommand>,
    feed: MicFeed,
}

impl AudioEngine {
    pub fn spawn(app: AppHandle, config: AudioConfig) -> Self {
        let (tx, rx) = mpsc::channel();
        let feed = MicFeed::start();
        let thread_feed = feed.clone();
        thread::Builder::new()
            .name("vibepad-audio".into())
            .spawn(move || run(app, rx, config, thread_feed))
            .expect("falha ao iniciar a thread de áudio");
        Self { tx, feed }
    }

    pub fn send(&self, cmd: AudioCommand) {
        let _ = self.tx.send(cmd);
    }

    pub fn native_mic_status(&self) -> FeedStatus {
        self.feed.status()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub is_virtual: bool,
}

pub fn list_output_devices() -> Vec<DeviceInfo> {
    let host = rodio::cpal::default_host();
    let default_name = host.default_output_device().and_then(|d| d.name().ok());
    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };
    devices
        .filter_map(|d| d.name().ok())
        .map(|name| DeviceInfo {
            is_default: default_name.as_deref() == Some(name.as_str()),
            is_virtual: is_virtual_name(&name),
            name,
        })
        .collect()
}

fn is_virtual_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    VIRTUAL_MIC_HINTS.iter().any(|hint| lower.contains(hint))
}

#[derive(Clone, Copy, PartialEq)]
enum Route {
    Mic,
    Monitor,
}

enum OutputKind {
    Device {
        handle: OutputStreamHandle,
        // Precisa continuar vivo enquanto o handle for usado.
        _stream: OutputStream,
    },
    NativeMic,
}

struct Output {
    route: Route,
    kind: OutputKind,
}

enum VoiceSink {
    Device(Sink),
    NativeMic(FeedHandle),
}

impl VoiceSink {
    fn set_volume(&self, volume: f32) {
        match self {
            VoiceSink::Device(sink) => sink.set_volume(volume),
            VoiceSink::NativeMic(handle) => handle.set_volume(volume),
        }
    }

    fn is_done(&self) -> bool {
        match self {
            VoiceSink::Device(sink) => sink.empty(),
            VoiceSink::NativeMic(handle) => handle.is_finished(),
        }
    }
}

struct Voice {
    sound_id: String,
    volume: f32,
    sinks: Vec<(Route, VoiceSink)>,
}

fn gain(route: Route, volume: f32, config: &AudioConfig) -> f32 {
    let monitor = if route == Route::Monitor { config.monitor_volume } else { 1.0 };
    (volume * config.master_volume * monitor).clamp(0.0, 2.0)
}

fn emit_error(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit("audio-error", message.into());
}

fn run(app: AppHandle, rx: mpsc::Receiver<AudioCommand>, mut config: AudioConfig, feed: MicFeed) {
    feed.set_block_mic(config.block_mic);
    let mut outputs = open_outputs(&app, &config);
    let mut voices: Vec<Voice> = Vec::new();
    let mut last_playing: Vec<String> = Vec::new();

    loop {
        match rx.recv_timeout(Duration::from_millis(80)) {
            Ok(AudioCommand::Play { sound_id, path, volume, exclusive }) => {
                if exclusive {
                    voices.clear();
                } else {
                    // Disparar o mesmo som de novo reinicia em vez de sobrepor.
                    voices.retain(|v| v.sound_id != sound_id);
                }
                match start_voice(&outputs, &config, &feed, &sound_id, path, volume) {
                    Ok(voice) => {
                        voices.push(voice);
                        let _ = app.emit("playback-started", &sound_id);
                    }
                    Err(e) => emit_error(&app, e),
                }
            }
            Ok(AudioCommand::Stop(id)) => voices.retain(|v| v.sound_id != id),
            Ok(AudioCommand::StopAll) => voices.clear(),
            Ok(AudioCommand::Configure(new_config)) => {
                let reopen = !new_config.same_devices(&config);
                config = new_config;
                feed.set_block_mic(config.block_mic);
                if reopen {
                    voices.clear();
                    outputs.clear();
                    outputs = open_outputs(&app, &config);
                } else {
                    for voice in &voices {
                        for (route, sink) in &voice.sinks {
                            sink.set_volume(gain(*route, voice.volume, &config));
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        voices.retain(|v| v.sinks.iter().any(|(_, s)| !s.is_done()));
        let playing: Vec<String> = voices.iter().map(|v| v.sound_id.clone()).collect();
        if playing != last_playing {
            let _ = app.emit("playback-state", &playing);
            last_playing = playing;
        }
    }
}

fn start_voice(
    outputs: &[Output],
    config: &AudioConfig,
    feed: &MicFeed,
    sound_id: &str,
    path: PathBuf,
    volume: f32,
) -> Result<Voice, String> {
    if outputs.is_empty() {
        return Err("Nenhum dispositivo de saída disponível. Verifique as configurações de áudio.".into());
    }
    let mut sinks = Vec::with_capacity(outputs.len());
    for output in outputs {
        let file = File::open(&path).map_err(|e| format!("Não foi possível abrir {}: {e}", path.display()))?;
        let source = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Formato não suportado ({}): {e}", path.display()))?;
        let level = gain(output.route, volume, config);
        let sink = match &output.kind {
            OutputKind::Device { handle, .. } => {
                let sink = Sink::try_new(handle).map_err(|e| format!("Erro no dispositivo de saída: {e}"))?;
                sink.set_volume(level);
                sink.append(source);
                VoiceSink::Device(sink)
            }
            OutputKind::NativeMic => VoiceSink::NativeMic(feed.play(source, level)),
        };
        sinks.push((output.route, sink));
    }
    Ok(Voice { sound_id: sound_id.to_string(), volume, sinks })
}

fn find_device(host: &rodio::cpal::Host, name: &str) -> Option<rodio::cpal::Device> {
    host.output_devices()
        .ok()?
        .find(|d| d.name().map(|n| n == name).unwrap_or(false))
}

fn detect_virtual_mic(host: &rodio::cpal::Host) -> Option<rodio::cpal::Device> {
    host.output_devices()
        .ok()?
        .find(|d| d.name().map(|n| is_virtual_name(&n)).unwrap_or(false))
}

fn open_outputs(app: &AppHandle, config: &AudioConfig) -> Vec<Output> {
    let host = rodio::cpal::default_host();
    let mut outputs: Vec<Output> = Vec::new();
    let mut wanted: Vec<(Route, Option<rodio::cpal::Device>)> = Vec::new();

    let wants_mic = matches!(config.mode, OutputMode::Both | OutputMode::MicOnly);
    if wants_mic && config.mic_backend == MicBackend::Native {
        outputs.push(Output { route: Route::Mic, kind: OutputKind::NativeMic });
    } else if wants_mic {
        let device = match &config.mic_device {
            Some(name) => find_device(&host, name),
            None => detect_virtual_mic(&host),
        };
        if device.is_none() {
            emit_error(
                app,
                "Microfone virtual não encontrado. Instale um cabo virtual (ex.: VB-Audio Virtual Cable) ou use o microfone nativo em Configurações.",
            );
        }
        wanted.push((Route::Mic, device));
    }
    if matches!(config.mode, OutputMode::Both | OutputMode::MonitorOnly) {
        let device = match &config.monitor_device {
            Some(name) => find_device(&host, name).or_else(|| host.default_output_device()),
            None => host.default_output_device(),
        };
        wanted.push((Route::Monitor, device));
    }

    let mut opened: Vec<String> = Vec::new();
    for (route, device) in wanted {
        let Some(device) = device else { continue };
        let name = device.name().unwrap_or_default();
        // Mesmo dispositivo nas duas rotas: toca só uma vez.
        if opened.contains(&name) {
            continue;
        }
        match OutputStream::try_from_device(&device) {
            Ok((stream, handle)) => {
                outputs.push(Output { route, kind: OutputKind::Device { handle, _stream: stream } });
                opened.push(name);
            }
            Err(e) => emit_error(app, format!("Falha ao abrir \"{name}\": {e}")),
        }
    }
    outputs
}
