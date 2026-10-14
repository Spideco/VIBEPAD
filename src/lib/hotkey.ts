// Conversão entre eventos de teclado e o formato de acelerador do
// tauri-plugin-global-shortcut (ex.: "Ctrl+Shift+F5", "Numpad1").

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
  "AltLeft", "AltRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight",
]);

/** Retorna a tecla principal (sem modificadores) para um `KeyboardEvent.code`. */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad/.test(code)) return code;
  if (/^Arrow(Up|Down|Left|Right)$/.test(code)) return code;
  const allowed = [
    "Space", "Enter", "Tab", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
    "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote",
    "Comma", "Period", "Slash", "Backquote", "PrintScreen", "ScrollLock", "Pause",
    "MediaPlayPause", "MediaStop", "MediaTrackNext", "MediaTrackPrevious",
    "AudioVolumeUp", "AudioVolumeDown", "AudioVolumeMute",
  ];
  return allowed.includes(code) ? code : null;
}

export type CaptureResult =
  | { kind: "pending"; preview: string }
  | { kind: "done"; accelerator: string }
  | { kind: "cancel" }
  | { kind: "clear" };

export function captureHotkey(e: KeyboardEvent): CaptureResult {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");

  if (MODIFIER_CODES.has(e.code)) return { kind: "pending", preview: mods.join("+") };
  if (e.code === "Escape" && mods.length === 0) return { kind: "cancel" };
  if ((e.code === "Backspace" || e.code === "Delete") && mods.length === 0) return { kind: "clear" };

  const key = keyFromCode(e.code);
  if (!key) return { kind: "pending", preview: mods.join("+") };
  return { kind: "done", accelerator: [...mods, key].join("+") };
}

/** Atalhos sem modificador "roubam" a tecla de todo o sistema (exceto teclas F e numpad). */
export function blocksTyping(accelerator: string): boolean {
  const parts = accelerator.split("+");
  if (parts.length > 1) return false;
  return !/^(F\d+|Numpad.*|Pause|ScrollLock|PrintScreen|Media.*|AudioVolume.*)$/.test(parts[0]);
}

const DISPLAY: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
  PageUp: "PgUp", PageDown: "PgDn", Delete: "Del", Insert: "Ins", PrintScreen: "PrtSc",
  ScrollLock: "ScrLk", Super: "Win", Space: "Espaço",
  NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *",
  NumpadDivide: "Num /", NumpadDecimal: "Num .", NumpadEnter: "Num Enter",
};

export function formatHotkey(accelerator: string): string {
  return accelerator
    .split("+")
    .map((p) => DISPLAY[p] ?? p.replace(/^Numpad(\d)$/, "Num $1"))
    .join("+");
}

const ALIASES: Record<string, string> = { control: "ctrl", option: "alt", cmd: "super", command: "super", meta: "super" };
const MODS = ["ctrl", "alt", "shift", "super"];

function normalize(accelerator: string): string {
  const parts = accelerator
    .toLowerCase()
    .split("+")
    .map((p) => ALIASES[p] ?? p.replace(/^key([a-z])$/, "$1").replace(/^digit(\d)$/, "$1"));
  const mods = parts.filter((p) => MODS.includes(p)).sort();
  return [...mods, ...parts.filter((p) => !MODS.includes(p))].join("+");
}

export function hotkeyEquals(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
