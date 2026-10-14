import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { mockApi } from "./mock";
import type { DeviceInfo, NativeMicState, Settings, Snapshot, Sound } from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Api {
  getState(): Promise<Snapshot>;
  listOutputDevices(): Promise<DeviceInfo[]>;
  pickAudioFiles(): Promise<string[]>;
  addSounds(paths: string[]): Promise<Sound[]>;
  removeSound(id: string): Promise<void>;
  updateSound(id: string, patch: { name?: string; volume?: number; favorite?: boolean }): Promise<Sound>;
  setHotkey(id: string, hotkey: string | null): Promise<Snapshot>;
  updateSettings(settings: Settings): Promise<Snapshot>;
  playSound(id: string): Promise<void>;
  stopSound(id: string): Promise<void>;
  stopAll(): Promise<void>;
  setHotkeysSuspended(suspended: boolean): Promise<Snapshot>;
  nativeMicState(): Promise<NativeMicState>;
  /** Abre o UAC e instala o microfone nativo; resolve com a mensagem de sucesso. */
  installNativeMic(guid: string): Promise<string>;
  uninstallNativeMic(guid: string): Promise<string>;
  onPlaybackState(cb: (ids: string[]) => void): Promise<UnlistenFn>;
  onPlaybackStarted(cb: (id: string) => void): Promise<UnlistenFn>;
  onAudioError(cb: (message: string) => void): Promise<UnlistenFn>;
}

export const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aac", "mp4"];

const tauriApi: Api = {
  getState: () => invoke("get_state"),
  listOutputDevices: () => invoke("list_output_devices"),
  async pickAudioFiles() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      multiple: true,
      title: "Adicionar sons",
      filters: [{ name: "Áudio", extensions: AUDIO_EXTENSIONS }],
    });
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  },
  addSounds: (paths) => invoke("add_sounds", { paths }),
  removeSound: (id) => invoke("remove_sound", { id }),
  updateSound: (id, patch) => invoke("update_sound", { id, ...patch }),
  setHotkey: (id, hotkey) => invoke("set_hotkey", { id, hotkey }),
  updateSettings: (settings) => invoke("update_settings", { settings }),
  playSound: (id) => invoke("play_sound", { id }),
  stopSound: (id) => invoke("stop_sound", { id }),
  stopAll: () => invoke("stop_all"),
  setHotkeysSuspended: (suspended) => invoke("set_hotkeys_suspended", { suspended }),
  nativeMicState: () => invoke("native_mic_state"),
  installNativeMic: (guid) => invoke("install_native_mic", { guid }),
  uninstallNativeMic: (guid) => invoke("uninstall_native_mic", { guid }),
  onPlaybackState: (cb) => listen<string[]>("playback-state", (e) => cb(e.payload)),
  onPlaybackStarted: (cb) => listen<string>("playback-started", (e) => cb(e.payload)),
  onAudioError: (cb) => listen<string>("audio-error", (e) => cb(e.payload)),
};

/** Fora do Tauri (ex.: `npm run dev` no navegador) usa dados simulados. */
export const api: Api = isTauri ? tauriApi : mockApi;

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
