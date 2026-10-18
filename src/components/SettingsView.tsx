import { Headphones, Mic, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { DeviceInfo, Settings } from "../lib/types";
import { OUTPUT_MODES } from "../lib/types";
import { MicCard } from "./MicCard";
import { Card, Field, Select, VolumeSlider } from "./ui";

interface Props {
  settings: Settings;
  devices: DeviceInfo[];
  onSettings: (patch: Partial<Settings>) => void;
  onRefreshDevices: () => void;
  onNotify: (kind: "success" | "error", message: string) => void;
}

const AUTO = "__auto__";

export function SettingsView({ settings, devices, onSettings, onRefreshDevices, onNotify }: Props) {
  const defaultOut = devices.find((d) => d.isDefault);

  return (
    <div className="h-full overflow-y-auto px-5 pt-4 pb-6">
      <div className="flex items-center mb-5">
        <div className="mr-auto">
          <h1 className="text-[17px] font-semibold text-white">Configurações</h1>
          <p className="text-xs text-muted">Roteamento de áudio e volumes.</p>
        </div>
        <button onClick={onRefreshDevices} className="h-9 px-3 rounded-lg border border-line text-sm flex items-center gap-2 text-zinc-300 hover:border-accent/60 hover:text-white">
          <RefreshCw size={14} /> Atualizar dispositivos
        </button>
      </div>

      <div className="space-y-4 max-w-3xl">
        <MicCard settings={settings} devices={devices} onSettings={onSettings} onNotify={onNotify} />

        <Card title="Saída de áudio" icon={<SlidersHorizontal size={16} />}>
          <Field label="Modo de saída" hint="Para onde cada som é enviado.">
            <div className="grid grid-cols-3 gap-2">
              {OUTPUT_MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => onSettings({ outputMode: m.value })}
                  className={`h-16 rounded-xl border text-xs flex flex-col items-center justify-center gap-1.5 transition-colors ${
                    settings.outputMode === m.value
                      ? "border-accent bg-accent/10 text-white"
                      : "border-line text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  <span className="flex gap-1">
                    {m.value !== "monitorOnly" && <Mic size={16} />}
                    {m.value !== "micOnly" && <Headphones size={16} />}
                  </span>
                  {m.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Fones (monitor)" hint="Onde você ouve os sons tocados.">
            <Select
              label="Fones"
              value={settings.monitorDevice ?? AUTO}
              onChange={(v) => onSettings({ monitorDevice: v === AUTO ? null : v })}
            >
              <option value={AUTO}>Padrão do sistema{defaultOut ? ` (${defaultOut.name})` : ""}</option>
              {devices.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Volume nos fones" hint="Relativo ao volume geral; não afeta o que os outros ouvem.">
            <div className="flex items-center gap-3 h-9">
              <VolumeSlider label="Volume nos fones" value={settings.monitorVolume} onChange={(v) => onSettings({ monitorVolume: v })} className="flex-1" />
              <span className="w-10 text-right text-sm tabular-nums text-muted">{Math.round(settings.monitorVolume * 100)}%</span>
            </div>
          </Field>
        </Card>


      </div>
    </div>
  );
}
