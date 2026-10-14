import { memo, useEffect, useRef, useState } from "react";
import { Heart, Keyboard, MoreHorizontal, Pencil, Play, Square, Trash2, Volume2, XCircle } from "lucide-react";
import type { Sound } from "../lib/types";
import { formatDuration } from "../lib/hotkey";
import { Waveform } from "./Waveform";
import { HotkeyBadge, useClickOutside, VolumeSlider } from "./ui";

export interface RowActions {
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onFavorite: (id: string, favorite: boolean) => void;
  onVolume: (id: string, volume: number) => void;
  onRename: (id: string, name: string) => void;
  onEditHotkey: (id: string) => void;
  onClearHotkey: (id: string) => void;
  onRemove: (id: string) => void;
}

interface Props extends RowActions {
  sound: Sound;
  selected: boolean;
  playing: boolean;
  startedAt?: number;
  hotkeyError?: string;
}

export const SoundRow = memo(function SoundRow(props: Props) {
  const { sound, selected, playing, startedAt, hotkeyError } = props;
  const [popover, setPopover] = useState<"none" | "volume" | "menu">("none");
  const [renaming, setRenaming] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  useClickOutside(popRef, () => setPopover("none"), popover !== "none");

  const iconBtn =
    "size-7 grid place-items-center rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors";

  return (
    <div
      onMouseDown={() => props.onSelect(sound.id)}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button,input")) return;
        props.onToggle(sound.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setPopover("menu");
      }}
      className={`group relative flex items-center gap-4 h-[54px] pl-2.5 pr-4 rounded-xl border transition-colors ${
        playing
          ? "border-accent/70 bg-[#1d1a22]"
          : selected
            ? "border-accent/45 bg-card-hover"
            : "border-line/70 bg-card hover:bg-card-hover hover:border-zinc-700"
      }`}
    >
      <button
        aria-label={playing ? `Parar ${sound.name}` : `Tocar ${sound.name}`}
        onClick={() => props.onToggle(sound.id)}
        className={`size-8 shrink-0 rounded-full grid place-items-center transition-all ${
          playing
            ? "bg-accent text-white"
            : "bg-white/10 text-zinc-200 hover:bg-accent hover:text-white"
        }`}
      >
        {playing ? <Square size={12} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0 flex items-center gap-2">
        {renaming ? (
          <RenameInput
            initial={sound.name}
            onDone={(name) => {
              setRenaming(false);
              if (name && name !== sound.name) props.onRename(sound.id, name);
            }}
          />
        ) : (
          <span className="truncate text-[14px] text-zinc-100" title={sound.path}>
            {sound.name}
          </span>
        )}
        {sound.favorite && !renaming && <Heart size={13} className="shrink-0 text-accent fill-accent" />}
      </div>

      <div
        ref={popRef}
        className={`relative flex items-center gap-0.5 ${
          popover !== "none" ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
        } transition-opacity`}
      >
        <button
          aria-label={sound.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          className={iconBtn}
          onClick={() => props.onFavorite(sound.id, !sound.favorite)}
        >
          <Heart size={15} className={sound.favorite ? "text-accent fill-accent" : ""} />
        </button>
        <button aria-label="Volume do som" className={iconBtn} onClick={() => setPopover(popover === "volume" ? "none" : "volume")}>
          <Volume2 size={15} />
        </button>
        <button aria-label="Mais opções" className={iconBtn} onClick={() => setPopover(popover === "menu" ? "none" : "menu")}>
          <MoreHorizontal size={16} />
        </button>

        {popover === "volume" && (
          <div className="vp-pop absolute right-0 top-9 z-30 w-56 rounded-xl border border-line bg-[#1e1e23] p-3 shadow-2xl">
            <div className="flex justify-between text-xs text-zinc-300 mb-2">
              <span>Volume deste som</span>
              <span className="tabular-nums text-muted">{Math.round(sound.volume * 100)}%</span>
            </div>
            <VolumeSlider label="Volume deste som" max={1.5} value={sound.volume} onChange={(v) => props.onVolume(sound.id, v)} className="w-full" />
          </div>
        )}
        {popover === "menu" && (
          <div className="vp-pop absolute right-0 top-9 z-30 w-52 rounded-xl border border-line bg-[#1e1e23] p-1.5 shadow-2xl text-sm">
            <MenuItem icon={<Keyboard size={15} />} label="Definir atalho" onClick={() => (setPopover("none"), props.onEditHotkey(sound.id))} />
            {sound.hotkey && (
              <MenuItem icon={<XCircle size={15} />} label="Remover atalho" onClick={() => (setPopover("none"), props.onClearHotkey(sound.id))} />
            )}
            <MenuItem icon={<Pencil size={15} />} label="Renomear" onClick={() => (setPopover("none"), setRenaming(true))} />
            <div className="h-px bg-line my-1" />
            <MenuItem danger icon={<Trash2 size={15} />} label="Remover da biblioteca" onClick={() => (setPopover("none"), props.onRemove(sound.id))} />
          </div>
        )}
      </div>

      <div className="w-[118px] flex justify-end shrink-0">
        <HotkeyBadge hotkey={sound.hotkey} error={hotkeyError} onClick={() => props.onEditHotkey(sound.id)} />
      </div>

      <span className="w-11 text-right text-[13px] text-zinc-400 tabular-nums shrink-0">
        {formatDuration(sound.durationMs)}
      </span>

      <div className="w-[34%] max-w-[300px] min-w-[140px] h-9 shrink-0">
        <Waveform peaks={sound.peaks} startedAt={playing ? startedAt : undefined} durationMs={sound.durationMs} active={playing || selected} />
      </div>
    </div>
  );
});

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 h-8 px-2.5 rounded-lg text-left ${
        danger ? "text-red-400 hover:bg-red-500/10" : "text-zinc-200 hover:bg-white/[0.07]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      defaultValue={initial}
      onBlur={(e) => onDone(e.target.value.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") onDone(null);
      }}
      className="w-full h-8 px-2 rounded-md bg-deep border border-accent/60 text-sm outline-none"
    />
  );
}
