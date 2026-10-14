import { Headphones, Info, Mic, PlayCircle, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { DeviceInfo, Settings } from "../lib/types";
import { OUTPUT_MODES, STOP_KEY } from "../lib/types";
import { Card, Field, HotkeyBadge, Select, Toggle, VolumeSlider } from "./ui";

interface Props {
  settings: Settings;
  devices: DeviceInfo[];
  hotkeyErrors: Record<string, string>;
  onSettings: (patch: Partial<Settings>) => void;
  onRefreshDevices: () => void;
  onEditStopHotkey: () => void;
}

const AUTO = "__auto__";

export function SettingsView({ settings, devices, hotkeyErrors, onSettings, onRefreshDevices, onEditStopHotkey }: Props) {
  const detectedMic = devices.find((d) => d.isVirtual);
  const defaultOut = devices.find((d) => d.isDefault);
  const usesMic = settings.outputMode !== "monitorOnly";
  const micMissing = usesMic && !(settings.micDevice ? devices.some((d) => d.name === settings.micDevice) : detectedMic);

  return (
    <div className="h-full overflow-y-auto px-5 pt-4 pb-6">
      <div className="flex items-center mb-5">
        <div className="mr-auto">
          <h1 className="text-[17px] font-semibold text-white">Configurações</h1>
          <p className="text-xs text-muted">Roteamento de áudio, volumes e comportamento de reprodução.</p>
        </div>
        <button onClick={onRefreshDevices} className="h-9 px-3 rounded-lg border border-line text-sm flex items-center gap-2 text-zinc-300 hover:border-accent/60 hover:text-white">
          <RefreshCw size={14} /> Atualizar dispositivos
        </button>
      </div>

      <div className="space-y-4 max-w-3xl">
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

          <Field
            label="Microfone virtual"
            hint={<>Dispositivo que alimenta o microfone em outros apps (ex.: <b>CABLE Input</b>).</>}
          >
            <Select
              label="Microfone virtual"
              value={settings.micDevice ?? AUTO}
              onChange={(v) => onSettings({ micDevice: v === AUTO ? null : v })}
            >
              <option value={AUTO}>Detectar automaticamente{detectedMic ? ` (${detectedMic.name})` : ""}</option>
              {devices.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.isVirtual ? "🎙 " : ""}
                  {d.name}
                </option>
              ))}
            </Select>
            {micMissing && (
              <p className="text-xs text-amber-300 mt-2 leading-relaxed">
                Nenhum cabo de áudio virtual encontrado. Instale o VB-Audio Virtual Cable (gratuito) e clique em "Atualizar dispositivos".
              </p>
            )}
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

        <Card title="Reprodução" icon={<PlayCircle size={16} />}>
          <Field label="Sobrepor sons" hint="Se desligado, iniciar um som interrompe o anterior.">
            <div className="h-9 flex items-center">
              <Toggle label="Sobrepor sons" checked={settings.allowOverlap} onChange={(v) => onSettings({ allowOverlap: v })} />
            </div>
          </Field>
          <Field label="Atalho “Parar tudo”" hint="Interrompe todos os sons de qualquer lugar.">
            <div className="h-9 flex items-center gap-2">
              <HotkeyBadge hotkey={settings.stopHotkey} error={hotkeyErrors[STOP_KEY]} onClick={onEditStopHotkey} placeholder="+ Definir atalho" />
              {settings.stopHotkey && (
                <button onClick={() => onSettings({ stopHotkey: null })} className="text-xs text-muted hover:text-red-300">
                  Remover
                </button>
              )}
            </div>
          </Field>
        </Card>

        <Card title="Como usar o som no microfone" icon={<Info size={16} />}>
          <ol className="text-sm text-zinc-300 space-y-2 list-decimal pl-5 leading-relaxed">
            <li>
              Instale um cabo de áudio virtual, como o <b className="text-white">VB-Audio Virtual Cable</b>.
            </li>
            <li>
              Aqui no VibePad, selecione <b className="text-white">CABLE Input</b> como microfone virtual.
            </li>
            <li>
              No Discord, jogo ou OBS, escolha <b className="text-white">CABLE Output</b> como dispositivo de entrada.
            </li>
            <li>
              Para enviar sua voz junto com os sons, abra as propriedades do seu microfone no Windows → aba
              <i> Escutar</i> → marque <i>Escutar este dispositivo</i> e reproduza em <b className="text-white">CABLE Input</b> (ou use o Voicemeeter).
            </li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
