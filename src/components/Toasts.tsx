import { useCallback, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";

export type ToastKind = "error" | "success" | "busy";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId++;
      setToasts((t) => [...t.filter((x) => x.message !== message), { id, kind, message }].slice(-4));
      if (kind !== "busy") setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3000);
      return id;
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`vp-pop flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-2xl backdrop-blur bg-[#1c1c21]/95 ${
            t.kind === "error" ? "border-red-500/40" : "border-line"
          }`}
        >
          {t.kind === "error" && <AlertTriangle size={17} className="text-red-400 shrink-0 mt-px" />}
          {t.kind === "success" && <CheckCircle2 size={17} className="text-neon shrink-0 mt-px" />}
          {t.kind === "busy" && <Loader2 size={17} className="text-neon shrink-0 mt-px animate-spin" />}
          <span className="flex-1 text-zinc-200 whitespace-pre-line break-words">{t.message}</span>
          <button aria-label="Fechar" onClick={() => onDismiss(t.id)} className="text-muted hover:text-white">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
