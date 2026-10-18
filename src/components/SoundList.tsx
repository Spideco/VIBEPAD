import { useRef, useState } from "react";
import { Check, Heart, Menu, Music, Plus, Search, Square } from "lucide-react";
import type { Sound } from "../lib/types";
import { SoundRow, type RowActions } from "./SoundRow";
import { useClickOutside } from "./ui";

export type SortKey = "added" | "name" | "duration" | "hotkey";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "added", label: "Ordem de adição" },
  { key: "name", label: "Nome (A–Z)" },
  { key: "duration", label: "Duração" },
  { key: "hotkey", label: "Com atalho primeiro" },
];

interface Props extends RowActions {
  title: string;
  sounds: Sound[];
  totalCount: number;
  favoritesMode: boolean;
  query: string;
  onQuery: (q: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  selectedId: string | null;
  playing: Set<string>;
  startedAt: Record<string, number>;
  paused: Record<string, number>;
  hotkeyErrors: Record<string, string>;
  onStopAll: () => void;
  onAdd: () => void;
}

export function SoundList(props: Props) {
  const { sounds, playing } = props;
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  useClickOutside(sortRef, () => setSortOpen(false), sortOpen);

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-3 px-5 pt-4 pb-3">
        <div className="mr-auto min-w-0">
          <h1 className="text-[17px] font-semibold text-white truncate">{props.title}</h1>
          <p className="text-xs text-muted">
            {sounds.length} {sounds.length === 1 ? "som" : "sons"}
            {playing.size > 0 && <span className="text-accent-soft"> · {playing.size} tocando</span>}
          </p>
        </div>

        <label className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && props.onQuery("")}
            placeholder="Buscar sons…"
            className="w-56 h-9 pl-9 pr-3 rounded-lg bg-white/[0.04] border border-line text-sm outline-none placeholder:text-muted focus:border-accent/60 focus:bg-white/[0.06]"
          />
        </label>

        <button
          onClick={props.onStopAll}
          disabled={playing.size === 0}
          className="h-9 px-3 rounded-lg border border-line text-sm flex items-center gap-2 text-zinc-200 enabled:hover:border-red-500/60 enabled:hover:text-red-300 disabled:opacity-40 transition-colors"
        >
          <Square size={13} fill="currentColor" />
          Parar tudo
        </button>

        <div ref={sortRef} className="relative">
          <button
            aria-label="Ordenar"
            onClick={() => setSortOpen((o) => !o)}
            className="size-9 grid place-items-center rounded-lg text-zinc-300 hover:bg-white/10"
          >
            <Menu size={19} />
          </button>
          {sortOpen && (
            <div className="vp-pop absolute right-0 top-11 z-30 w-52 rounded-xl border border-line bg-[#1e1e23] p-1.5 shadow-2xl text-sm">
              <div className="px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-muted">Ordenar por</div>
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => (props.onSort(s.key), setSortOpen(false))}
                  className="w-full flex items-center justify-between h-8 px-2.5 rounded-lg text-left text-zinc-200 hover:bg-white/[0.07]"
                >
                  {s.label}
                  {props.sort === s.key && <Check size={15} className="text-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 space-y-2">
        {sounds.length === 0 ? (
          <EmptyState favorites={props.favoritesMode} searching={!!props.query} hasSounds={props.totalCount > 0} onAdd={props.onAdd} />
        ) : (
          sounds.map((s) => (
            <SoundRow
              key={s.id}
              sound={s}
              selected={props.selectedId === s.id}
              playing={playing.has(s.id)}
              startedAt={props.startedAt[s.id]}
              pausedAt={props.paused[s.id]}
              hotkeyError={props.hotkeyErrors[s.id]}
              onSelect={props.onSelect}
              onToggle={props.onToggle}
              onSeek={props.onSeek}
              onFavorite={props.onFavorite}
              onVolume={props.onVolume}
              onRename={props.onRename}
              onEditHotkey={props.onEditHotkey}
              onClearHotkey={props.onClearHotkey}
              onRemove={props.onRemove}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ favorites, searching, hasSounds, onAdd }: { favorites: boolean; searching: boolean; hasSounds: boolean; onAdd: () => void }) {
  if (searching) {
    return <div className="text-center text-muted text-sm pt-20">Nenhum som corresponde à busca.</div>;
  }
  if (favorites && hasSounds) {
    return (
      <div className="flex flex-col items-center text-center pt-20 gap-3">
        <Heart size={36} className="text-accent/70" />
        <p className="text-zinc-300">Nenhum favorito ainda</p>
        <p className="text-sm text-muted max-w-xs">Passe o mouse sobre um som e clique no coração para fixá-lo aqui.</p>
      </div>
    );
  }
  return (
    <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center gap-4 rounded-2xl border-2 border-dashed border-line">
      <div className="size-16 rounded-2xl bg-accent/10 grid place-items-center">
        <Music size={30} className="text-accent" />
      </div>
      <div>
        <p className="text-zinc-100 font-medium">Sua biblioteca está vazia</p>
        <p className="text-sm text-muted mt-1">Arraste arquivos de áudio para cá (MP3, WAV, OGG, FLAC, M4A)</p>
      </div>
      <button
        onClick={onAdd}
        className="h-9 px-4 rounded-lg bg-brand text-sm font-medium flex items-center gap-2 hover:brightness-110"
      >
        <Plus size={16} /> Adicionar Som
      </button>
    </div>
  );
}
