import { Copy, Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/api";

const win = isTauri ? getCurrentWindow() : null;

/** Barra de título personalizada (a janela é criada sem decorações). */
export function TitleBar() {
  const btn = "w-11 h-9 grid place-items-center text-zinc-400 hover:text-white transition-colors";
  return (
    <div data-tauri-drag-region className="h-9 flex justify-end shrink-0 relative z-20">
      <button aria-label="Minimizar" className={`${btn} hover:bg-white/10`} onClick={() => win?.minimize()}>
        <Minus size={15} />
      </button>
      <button aria-label="Maximizar" className={`${btn} hover:bg-white/10`} onClick={() => win?.toggleMaximize()}>
        <Copy size={13} className="-scale-x-100" />
      </button>
      <button aria-label="Fechar" className={`${btn} hover:bg-red-600`} onClick={() => win?.close()}>
        <X size={16} />
      </button>
    </div>
  );
}
