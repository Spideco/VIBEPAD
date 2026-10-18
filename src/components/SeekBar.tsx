import { memo, useRef, useState } from "react";
import { formatDuration } from "../lib/hotkey";

interface Props {
  durationMs: number;
  /** Fração já tocada (0–1). */
  progress: number;
  playing: boolean;
  active: boolean;
  label: string;
  onSeek: (ms: number) => void;
}

/**
 * Barra de reprodução no estilo do YouTube: clique ou arraste para mudar a
 * posição. Com o som parado, clicar começa a tocar daquele ponto.
 */
export const SeekBar = memo(function SeekBar({ durationMs, progress, playing, active, label, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  // O pointerup pode chegar antes do React renderizar o pointerdown.
  const dragging = useRef(false);

  const fractionAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const seekTo = (fraction: number) => onSeek(Math.round(fraction * durationMs));

  const shown = drag ?? progress;
  const hot = hover !== null || drag !== null;
  const tip = drag ?? hover;

  return (
    <div
      data-seekbar
      role="slider"
      tabIndex={0}
      aria-label={`Posição de ${label}`}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round((shown * durationMs) / 1000)}
      aria-valuetext={`${formatDuration(shown * durationMs)} de ${formatDuration(durationMs)}`}
      className="group/seek relative h-full flex items-center cursor-pointer outline-none touch-none"
      onPointerMove={(e) => {
        const f = fractionAt(e.clientX);
        setHover(f);
        if (dragging.current) setDrag(f);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        setDrag(fractionAt(e.clientX));
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        seekTo(fractionAt(e.clientX));
        setDrag(null);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setDrag(null);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.05;
        const keys: Record<string, number> = {
          ArrowRight: progress + step,
          ArrowLeft: progress - step,
          Home: 0,
          End: 0.999,
        };
        if (!(e.key in keys)) return;
        e.preventDefault();
        e.stopPropagation();
        seekTo(Math.min(1, Math.max(0, keys[e.key])));
      }}
    >
      <div
        ref={trackRef}
        className={`relative w-full rounded-full bg-white/15 transition-[height] duration-100 ${
          hot ? "h-[6px]" : "h-[4px]"
        } group-focus-visible/seek:ring-2 group-focus-visible/seek:ring-accent-soft/60`}
      >
        {hover !== null && drag === null && (
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${hover * 100}%` }} />
        )}
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${playing || drag !== null ? "bg-accent" : active ? "bg-zinc-400" : "bg-zinc-500"}`}
          style={{ width: `${shown * 100}%` }}
        />
        <div
          className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow transition-transform duration-100 ${
            hot || playing ? "scale-100" : "scale-0"
          }`}
          style={{ left: `${shown * 100}%` }}
        />
      </div>

      {tip !== null && (
        <div
          className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded-md bg-[#1e1e23] border border-line px-1.5 py-0.5 text-[11px] text-zinc-100 tabular-nums shadow-lg"
          style={{ left: `${tip * 100}%` }}
        >
          {formatDuration(tip * durationMs)}
        </div>
      )}
    </div>
  );
});
