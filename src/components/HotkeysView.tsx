import { Pencil, Play, Square, X } from "lucide-react";
import type { Settings, Sound } from "../lib/types";
import { STOP_KEY } from "../lib/types";
import { HotkeyBadge } from "./ui";

interface Props {
  sounds: Sound[];
  settings: Settings;
  hotkeyErrors: Record<string, string>;
  onEdit: (soundId: string | null) => void;
  onClear: (soundId: string | null) => void;
  onPlay: (id: string) => void;
}

export function HotkeysView({ sounds, settings, hotkeyErrors, onEdit, onClear, onPlay }: Props) {
  const withKey = sounds.filter((s) => s.hotkey);
  const withoutKey = sounds.filter((s) => !s.hotkey);
  const errorCount = Object.keys(hotkeyErrors).length;

  return (
    <div className="h-full overflow-y-auto px-5 pt-4 pb-6">
      <h1 className="text-[17px] font-semibold text-white">Teclas de Atalho</h1>
      <p className="text-xs text-muted mb-5">
        Atalhos globais funcionam mesmo com o VibePad em segundo plano (inclusive durante jogos).
        {errorCount > 0 && <span className="text-amber-300"> · {errorCount} com problema</span>}
      </p>

      <Section title="Controles">
        <Row
          icon={<Square size={12} fill="currentColor" />}
          name="Parar todos os sons"
          hotkey={settings.stopHotkey}
          error={hotkeyErrors[STOP_KEY]}
          onEdit={() => onEdit(null)}
          onClear={() => onClear(null)}
        />
      </Section>

      <Section title={`Sons com atalho (${withKey.length})`}>
        {withKey.length === 0 && <p className="text-sm text-muted px-1 py-2">Nenhum som tem atalho ainda.</p>}
        {withKey.map((s) => (
          <Row
            key={s.id}
            icon={<Play size={12} fill="currentColor" />}
            onIcon={() => onPlay(s.id)}
            name={s.name}
            hotkey={s.hotkey}
            error={hotkeyErrors[s.id]}
            onEdit={() => onEdit(s.id)}
            onClear={() => onClear(s.id)}
          />
        ))}
      </Section>

      {withoutKey.length > 0 && (
        <Section title={`Sem atalho (${withoutKey.length})`}>
          {withoutKey.map((s) => (
            <Row key={s.id} icon={<Play size={12} fill="currentColor" />} onIcon={() => onPlay(s.id)} name={s.name} hotkey={null} onEdit={() => onEdit(s.id)} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-[11px] uppercase tracking-wider text-muted mb-2 px-1">{title}</h2>
      <div className="rounded-xl border border-line/70 bg-card/60 divide-y divide-line/60">{children}</div>
    </section>
  );
}

function Row({
  icon,
  onIcon,
  name,
  hotkey,
  error,
  onEdit,
  onClear,
}: {
  icon: React.ReactNode;
  onIcon?: () => void;
  name: string;
  hotkey: string | null;
  error?: string;
  onEdit: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 h-12 px-3">
      <button
        onClick={onIcon}
        disabled={!onIcon}
        className="size-7 rounded-full grid place-items-center bg-white/10 text-zinc-300 enabled:hover:bg-accent enabled:hover:text-white"
      >
        {icon}
      </button>
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm text-zinc-100">{name}</div>
        {error && <div className="truncate text-xs text-amber-300/90">{error}</div>}
      </div>
      <HotkeyBadge hotkey={hotkey} error={error} onClick={onEdit} placeholder="+ Definir atalho" />
      <div className="w-16 flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {hotkey && (
          <>
            <button aria-label="Editar atalho" onClick={onEdit} className="size-7 grid place-items-center rounded-md text-zinc-400 hover:text-white hover:bg-white/10">
              <Pencil size={14} />
            </button>
            {onClear && (
              <button aria-label="Remover atalho" onClick={onClear} className="size-7 grid place-items-center rounded-md text-zinc-400 hover:text-red-300 hover:bg-white/10">
                <X size={15} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
