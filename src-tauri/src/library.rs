use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::audio::{AudioConfig, OutputMode};

fn default_volume() -> f32 {
    1.0
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Sound {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub hotkey: Option<String>,
    #[serde(default = "default_volume")]
    pub volume: f32,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub peaks: Vec<f32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub mic_device: Option<String>,
    pub monitor_device: Option<String>,
    pub output_mode: OutputMode,
    pub master_volume: f32,
    pub monitor_volume: f32,
    pub allow_overlap: bool,
    pub stop_hotkey: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            mic_device: None,
            monitor_device: None,
            output_mode: OutputMode::Both,
            master_volume: 0.8,
            monitor_volume: 0.7,
            allow_overlap: false,
            stop_hotkey: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Library {
    pub sounds: Vec<Sound>,
    pub settings: Settings,
}

impl Library {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    /// Grava em um arquivo temporário e renomeia, para não corromper a biblioteca.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    }

    pub fn audio_config(&self) -> AudioConfig {
        let s = &self.settings;
        AudioConfig {
            mic_device: s.mic_device.clone(),
            monitor_device: s.monitor_device.clone(),
            mode: s.output_mode,
            master_volume: s.master_volume,
            monitor_volume: s.monitor_volume,
        }
    }

    pub fn sound(&self, id: &str) -> Option<&Sound> {
        self.sounds.iter().find(|s| s.id == id)
    }

    pub fn sound_mut(&mut self, id: &str) -> Option<&mut Sound> {
        self.sounds.iter_mut().find(|s| s.id == id)
    }
}
