export type OutputMode = "both" | "micOnly" | "monitorOnly";

export interface Sound {
  id: string;
  name: string;
  path: string;
  hotkey: string | null;
  volume: number;
  favorite: boolean;
  durationMs: number;
  peaks: number[];
}

export interface Settings {
  micDevice: string | null;
  monitorDevice: string | null;
  outputMode: OutputMode;
  masterVolume: number;
  monitorVolume: number;
  allowOverlap: boolean;
  stopHotkey: string | null;
}

export interface Snapshot {
  sounds: Sound[];
  settings: Settings;
  /** Falhas de registro por id de som (ou "__stop__"). */
  hotkeyErrors: Record<string, string>;
}

export interface DeviceInfo {
  name: string;
  isDefault: boolean;
  isVirtual: boolean;
}

export type View = "library" | "favorites" | "hotkeys" | "settings";

export const STOP_KEY = "__stop__";

export const OUTPUT_MODES: { value: OutputMode; label: string }[] = [
  { value: "both", label: "Microfone + Fones" },
  { value: "micOnly", label: "Apenas Microfone" },
  { value: "monitorOnly", label: "Apenas Fones" },
];
