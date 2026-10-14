import { memo, useEffect, useId, useState } from "react";

const BAR_STEP = 3;
const HEIGHT = 40;

interface Props {
  peaks: number[];
  /** Momento (performance.now) em que a reprodução começou, se estiver tocando. */
  startedAt?: number;
  durationMs: number;
  active: boolean;
}

/** Barras espelhadas; a parte já tocada é coberta pela versão colorida via clipPath. */
export const Waveform = memo(function Waveform({ peaks, startedAt, durationMs, active }: Props) {
  const clipId = useId();
  const progress = usePlaybackProgress(startedAt, durationMs);
  const bars = peaks.length ? peaks : Array.from({ length: 60 }, () => 0.08);
  const width = bars.length * BAR_STEP;

  const path = bars
    .map((p, i) => {
      const h = Math.max(1.5, p * (HEIGHT - 4));
      const y = (HEIGHT - h) / 2;
      return `M${i * BAR_STEP + 0.6} ${y}h1.8v${h}h-1.8z`;
    })
    .join("");

  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="w-full h-full"
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect width={width * progress} height={HEIGHT} />
        </clipPath>
      </defs>
      <path d={path} fill={active ? "#c9c9d3" : "#8f8f9b"} opacity={active ? 0.75 : 0.9} />
      {progress > 0 && <path d={path} fill="#a66bcc" clipPath={`url(#${clipId})`} />}
    </svg>
  );
});

function usePlaybackProgress(startedAt: number | undefined, durationMs: number) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (startedAt === undefined || durationMs <= 0) {
      setProgress(0);
      return;
    }
    let frame = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - startedAt) / durationMs);
      setProgress(p);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [startedAt, durationMs]);
  return progress;
}
