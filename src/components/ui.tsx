import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { formatHotkey } from "../lib/hotkey";

export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void, enabled = true) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, enabled]);
}

export function VolumeSlider({
  value,
  max = 1,
  onChange,
  className = "",
  label,
}: {
  value: number;
  max?: number;
  onChange: (v: number) => void;
  className?: string;
  label: string;
}) {
  return (
    <input
      type="range"
      aria-label={label}
      min={0}
      max={max}
      step={0.01}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`vp-range ${className}`}
      style={{ ["--val" as string]: `${(value / max) * 100}%` }}
    />
  );
}

export function HotkeyBadge({
  hotkey,
  error,
  onClick,
  placeholder = "Definir",
}: {
  hotkey: string | null;
  error?: string;
  onClick?: () => void;
  placeholder?: string;
}) {
  const base =
    "inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[11px] font-semibold tracking-wide whitespace-nowrap transition-colors";
  if (!hotkey) {
    return (
      <button
        onClick={onClick}
        className={`${base} border-dashed border-line text-muted hover:border-accent/60 hover:text-accent-soft`}
      >
        {placeholder}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      title={error ?? "Clique para alterar o atalho"}
      className={`${base} ${
        error
          ? "border-amber-500/70 text-amber-300 bg-amber-500/10"
          : "border-accent/70 text-accent-soft bg-accent/10 hover:bg-accent/20"
      }`}
    >
      {error && <AlertTriangle size={11} />}[{formatHotkey(hotkey)}]
    </button>
  );
}

export function Select({
  value,
  onChange,
  children,
  className = "",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none h-9 pl-3 pr-8 rounded-lg bg-deep/70 border border-line text-sm text-zinc-100 outline-none hover:border-zinc-600 focus:border-accent/70 cursor-pointer truncate"
      >
        {children}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${
        checked ? "bg-brand" : "bg-zinc-700"
      }`}
    >
      <span
        className={`absolute top-1 left-1 size-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

export function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line/70 bg-card/70 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100 mb-4">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
      <div className="pt-2">
        <div className="text-sm text-zinc-200">{label}</div>
        {hint && <div className="text-xs text-muted mt-0.5 leading-relaxed">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
