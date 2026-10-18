import { useEffect, useState } from "react";

/** Fração tocada, atualizada a cada quadro enquanto o som toca. */
export function usePlaybackProgress(startedAt: number | undefined, durationMs: number) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (startedAt === undefined || durationMs <= 0) {
      setProgress(0);
      return;
    }
    let frame = 0;
    const tick = () => {
      const p = Math.min(1, Math.max(0, (performance.now() - startedAt) / durationMs));
      setProgress(p);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [startedAt, durationMs]);
  return progress;
}
