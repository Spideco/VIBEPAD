import { useEffect, useState } from "react";
import { AlertTriangle, Keyboard } from "lucide-react";
import { api } from "../lib/api";
import { blocksTyping, captureHotkey, formatHotkey } from "../lib/hotkey";

export interface RecordTarget {
  /** id do som, ou null para o atalho "Parar tudo". */
  soundId: string | null;
  label: string;
  current: string | null;
}

interface Props {
  target: RecordTarget;
  /** Retorna o nome de quem já usa a combinação, se houver. */
  findConflict: (accelerator: string) => string | null;
  onSave: (accelerator: string | null) => Promise<void>;
  onClose: () => void;
}

export function HotkeyRecorder({ target, findConflict, onSave, onClose }: Props) {
  const [preview, setPreview] = useState("");
  const [captured, setCaptured] = useState<string | null>(target.current);
  const [saving, setSaving] = useState(false);

  // Enquanto grava, os atalhos globais ficam desligados para que a tecla chegue até aqui.
  useEffect(() => {
    api.setHotkeysSuspended(true).catch(() => {});
    return () => {
      api.setHotkeysSuspended(false).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const r = captureHotkey(e);
      if (r.kind === "cancel") onClose();
      else if (r.kind === "clear") setCaptured(null);
      else if (r.kind === "pending") setPreview(r.preview);
      else {
        setCaptured(r.accelerator);
        setPreview("");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) setPreview("");
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [onClose]);

  const shown = preview ? `${preview}+…` : captured;
  const conflict = captured && captured !== target.current ? findConflict(captured) : null;
  const changed = captured !== target.current;

  const save = async () => {
    setSaving(true);
    try {
      // Reativa os atalhos antes de salvar, para que o back-end valide o registro real.
      await api.setHotkeysSuspended(false);
      await onSave(captured);
      onClose();
    } catch {
      await api.setHotkeysSuspended(true).catch(() => {});
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Gravar atalho"
        onMouseDown={(e) => e.stopPropagation()}
        className="vp-pop w-[420px] rounded-2xl border border-line bg-[#18181c] p-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="size-10 rounded-xl bg-accent/15 grid place-items-center text-accent">
            <Keyboard size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-white">Definir atalho</h2>
            <p className="text-sm text-muted truncate">{target.label}</p>
          </div>
        </div>

        <div className="h-24 rounded-xl border border-accent/40 bg-accent/[0.06] grid place-items-center">
          {shown ? (
            <div className="flex items-center gap-1.5">
              {shown.split("+").map((k, i) => (
                <kbd
                  key={i}
                  className="min-w-9 h-9 px-2.5 grid place-items-center rounded-lg border border-accent/60 bg-[#241a2e] text-accent-soft text-sm font-semibold"
                >
                  {k === "…" ? "…" : formatHotkey(k)}
                </kbd>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted">Pressione a combinação de teclas…</span>
          )}
        </div>

        <div className="min-h-[44px] mt-3 space-y-1.5 text-xs">
          {conflict && (
            <p className="flex gap-1.5 text-amber-300">
              <AlertTriangle size={14} className="shrink-0" /> Já usado por "{conflict}" — será transferido para este som.
            </p>
          )}
          {captured && blocksTyping(captured) && (
            <p className="flex gap-1.5 text-amber-300/90">
              <AlertTriangle size={14} className="shrink-0" /> Sem modificador, esta tecla deixa de funcionar em outros programas.
            </p>
          )}
          <p className="text-muted">
            <kbd className="">Esc</kbd> cancela · <kbd className="">Backspace</kbd> remove o atalho
          </p>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm text-zinc-300 hover:bg-white/10">
            Cancelar
          </button>
          <button
            disabled={!changed || saving}
            onClick={save}
            className="h-9 px-5 rounded-lg text-sm font-medium bg-brand text-white disabled:opacity-40 enabled:hover:brightness-110"
          >
            {captured ? "Salvar" : "Remover atalho"}
          </button>
        </div>
      </div>
    </div>
  );
}
