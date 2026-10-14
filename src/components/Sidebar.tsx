import { Heart, Keyboard, Library, Plus, Settings as SettingsIcon, Volume1, Volume2, VolumeX } from "lucide-react";
import type { ReactNode } from "react";
import { OUTPUT_MODES, type OutputMode, type Settings, type View } from "../lib/types";
import { Select, VolumeSlider } from "./ui";

interface Props {
  view: View;
  onView: (v: View) => void;
  onAdd: () => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  counts: { library: number; favorites: number };
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="size-9 rounded-xl bg-gradient-to-br from-neon to-brand grid place-items-center shadow-[0_0_18px_rgba(180,77,255,0.45)]">
        <svg viewBox="0 0 24 24" className="size-5" fill="white">
          <rect x="3" y="9" width="2.4" height="6" rx="1.2" />
          <rect x="7.4" y="6" width="2.4" height="12" rx="1.2" />
          <rect x="11.8" y="3" width="2.4" height="18" rx="1.2" />
          <rect x="16.2" y="7" width="2.4" height="10" rx="1.2" />
          <rect x="20.2" y="10" width="1.8" height="4" rx="0.9" />
        </svg>
      </div>
      <span className="text-[22px] tracking-[0.08em] leading-none">
        <span className="font-bold text-white">VIBE</span>
        <span className="font-light text-zinc-300">PAD</span>
      </span>
    </div>
  );
}

function NavItem({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 h-10 px-3 rounded-lg text-sm transition-colors ${
        active
          ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
          : "text-zinc-300 hover:bg-white/[0.04] hover:text-white"
      }`}
    >
      <span className={active ? "text-neon-soft" : "text-zinc-400"}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && <span className="text-xs text-muted tabular-nums">{count}</span>}
    </button>
  );
}

export function Sidebar({ view, onView, onAdd, settings, onSettings, counts }: Props) {
  const VolIcon = settings.masterVolume === 0 ? VolumeX : settings.masterVolume < 0.5 ? Volume1 : Volume2;
  return (
    <aside className="w-60 shrink-0 flex flex-col pt-1 pb-1 relative z-10">
      <Logo />

      <nav className="mt-8 space-y-1">
        <NavItem active={view === "library"} icon={<Library size={18} />} label="Minha Biblioteca" count={counts.library} onClick={() => onView("library")} />
        <NavItem active={view === "favorites"} icon={<Heart size={18} />} label="Favoritos" count={counts.favorites} onClick={() => onView("favorites")} />
        <NavItem active={view === "hotkeys"} icon={<Keyboard size={18} />} label="Teclas de Atalho (Hotkeys)" onClick={() => onView("hotkeys")} />
        <NavItem active={view === "settings"} icon={<SettingsIcon size={18} />} label="Configurações" onClick={() => onView("settings")} />
      </nav>

      <div className="h-px bg-line my-5 mx-1" />

      <button
        onClick={onAdd}
        className="h-10 rounded-lg bg-gradient-to-r from-brand to-neon text-white text-sm font-medium flex items-center justify-center gap-2 shadow-[0_6px_24px_-6px_rgba(180,77,255,0.7)] hover:brightness-110 active:brightness-95 transition"
      >
        <Plus size={17} strokeWidth={2.5} />
        Adicionar Som
      </button>

      <div className="mt-auto rounded-xl border border-line/80 bg-card/80 backdrop-blur p-3 space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs text-zinc-300 mb-2">
            <span>Volume geral</span>
            <span className="tabular-nums text-muted">{Math.round(settings.masterVolume * 100)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Silenciar"
              className="text-zinc-400 hover:text-white"
              onClick={() => onSettings({ masterVolume: settings.masterVolume > 0 ? 0 : 0.8 })}
            >
              <VolIcon size={16} />
            </button>
            <VolumeSlider label="Volume geral" value={settings.masterVolume} onChange={(v) => onSettings({ masterVolume: v })} className="flex-1" />
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-300 mb-2">Dispositivo de Saída:</div>
          <Select
            label="Dispositivo de saída"
            value={settings.outputMode}
            onChange={(v) => onSettings({ outputMode: v as OutputMode })}
          >
            {OUTPUT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </aside>
  );
}
