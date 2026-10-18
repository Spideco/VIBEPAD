// Back-end simulado para pré-visualizar a interface no navegador, sem o Tauri.
import type { Api } from "./api";
import type { Settings, Snapshot, Sound } from "./types";

function fakePeaks(seed: number, shape: "burst" | "steady" | "swell"): number[] {
  let x = seed;
  const rand = () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
  return Array.from({ length: 120 }, (_, i) => {
    const t = i / 119;
    const env =
      shape === "burst" ? Math.exp(-3 * t) : shape === "swell" ? Math.sin(Math.PI * t) : 0.7 + 0.3 * Math.sin(t * 12);
    return Math.round(Math.max(0.05, env * (0.35 + 0.65 * rand())) * 100) / 100;
  });
}

const sample = (id: string, name: string, hotkey: string | null, durationMs: number, shape: "burst" | "steady" | "swell", favorite = false): Sound => ({
  id,
  name,
  path: `C:\\Sons\\${name}`,
  hotkey,
  volume: 1,
  favorite,
  durationMs,
  peaks: fakePeaks(id.charCodeAt(0) * 7 + id.length * 13, shape),
});

const state: Snapshot = {
  sounds: [
    sample("a1", "Laughter.mp3", "Ctrl+1", 3200, "steady", true),
    sample("b2", "Explosion.wav", "F5", 2100, "burst"),
    sample("c3", "Victory Horn.mp3", "F9", 5400, "swell", true),
    sample("d4", "Airhorn.mp3", "Ctrl+Shift+A", 1800, "steady"),
    sample("e5", "Crickets.wav", "F6", 6000, "steady"),
    sample("f6", "Drum Roll.wav", null, 4200, "swell"),
    sample("g7", "Sad Trombone.mp3", "F7", 3600, "swell"),
    sample("h8", "Bruh.mp3", "Alt+B", 900, "burst"),
    sample("i9", "Wow.mp3", null, 1300, "burst"),
  ],
  settings: {
    micBackend: "native",
    blockMic: false,
    micDevice: null,
    monitorDevice: null,
    outputMode: "both",
    masterVolume: 0.8,
    monitorVolume: 0.7,
    allowOverlap: false,
    stopHotkey: "Pause",
  },
  hotkeyErrors: {},
};

const mockMics = [
  { guid: "{a1}", name: "Microfone (HyperX Cloud II)", isDefault: true, installed: false },
  { guid: "{b2}", name: "Microfone (Realtek High Definition Audio)", isDefault: false, installed: false },
];

type Cb<T> = (v: T) => void;
const stateListeners = new Set<Cb<string[]>>();
const startedListeners = new Set<(id: string, positionMs: number) => void>();
const timers = new Map<string, number>();

const clone = (): Snapshot => structuredClone(state);
const emitState = () => stateListeners.forEach((cb) => cb([...timers.keys()]));
const sub = <F>(set: Set<F>, cb: F) => {
  set.add(cb);
  return Promise.resolve(() => void set.delete(cb));
};

function stop(id: string) {
  const t = timers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(id);
  }
}

export const mockApi: Api = {
  getState: async () => clone(),
  listOutputDevices: async () => [
    { name: "Alto-falantes (Realtek High Definition Audio)", isDefault: true, isVirtual: false },
    { name: "Fones de ouvido (HyperX Cloud II)", isDefault: false, isVirtual: false },
    { name: "CABLE Input (VB-Audio Virtual Cable)", isDefault: false, isVirtual: true },
  ],
  pickAudioFiles: async () => [],
  addSounds: async () => [],
  async removeSound(id) {
    stop(id);
    state.sounds = state.sounds.filter((s) => s.id !== id);
    emitState();
  },
  async updateSound(id, patch) {
    const s = state.sounds.find((s) => s.id === id)!;
    Object.assign(s, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return structuredClone(s);
  },
  async setHotkey(id, hotkey) {
    for (const s of state.sounds) {
      if (s.id === id) s.hotkey = hotkey;
      else if (hotkey && s.hotkey?.toLowerCase() === hotkey.toLowerCase()) s.hotkey = null;
    }
    return clone();
  },
  async updateSettings(settings: Settings) {
    state.settings = { ...settings };
    return clone();
  },
  async playSound(id, startMs = 0) {
    if (!state.settings.allowOverlap) [...timers.keys()].forEach(stop);
    stop(id);
    const s = state.sounds.find((s) => s.id === id)!;
    timers.set(id, window.setTimeout(() => (timers.delete(id), emitState()), Math.max(0, s.durationMs - startMs)));
    startedListeners.forEach((cb) => cb(id, startMs));
    emitState();
  },
  async stopSound(id) {
    stop(id);
    emitState();
  },
  async stopAll() {
    [...timers.keys()].forEach(stop);
    emitState();
  },
  setHotkeysSuspended: async () => clone(),
  async nativeMicState() {
    return {
      devices: mockMics.map((m) => ({ ...m })),
      feed: { connected: mockMics.some((m) => m.installed), active: mockMics.some((m) => m.installed), micRate: 48000, micChannels: 2 },
      dllAvailable: true,
    };
  },
  async installNativeMic(guid) {
    await new Promise((r) => setTimeout(r, 800));
    mockMics.forEach((m) => m.guid === guid && (m.installed = true));
    return "Microfone nativo instalado.";
  },
  async uninstallNativeMic(guid) {
    mockMics.forEach((m) => m.guid === guid && (m.installed = false));
    return "Microfone nativo removido.";
  },
  onPlaybackState: (cb) => sub(stateListeners, cb),
  onPlaybackStarted: (cb) => sub(startedListeners, cb),
  onAudioError: () => Promise.resolve(() => {}),
};
