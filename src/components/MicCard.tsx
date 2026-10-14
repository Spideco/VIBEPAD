import { useCallback, useEffect, useState } from "react";
import { Cable, Loader2, Mic, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { DeviceInfo, MicBackend, NativeMicState, Settings } from "../lib/types";
import { Card, Field, Select, Toggle } from "./ui";

interface Props {
  settings: Settings;
  devices: DeviceInfo[];
  onSettings: (patch: Partial<Settings>) => void;
  onNotify: (kind: "success" | "error", message: string) => void;
}

const AUTO = "__auto__";

const BACKENDS: { value: MicBackend; title: string; description: string; icon: React.ReactNode }[] = [
  { value: "native", title: "Nativo (recomendado)", description: "Direto no seu microfone, como o Soundpad", icon: <Mic size={17} /> },
  { value: "virtualCable", title: "Cabo virtual", description: "VB-Audio Cable ou Voicemeeter", icon: <Cable size={17} /> },
];

export function MicCard({ settings, devices, onSettings, onNotify }: Props) {
  const native = settings.micBackend === "native";

  return (
    <Card title="Microfone" icon={<Mic size={16} />}>
      <Field label="Método" hint="Como os sons chegam a quem está te ouvindo.">
        <div className="grid grid-cols-2 gap-2">
          {BACKENDS.map((b) => (
            <button
              key={b.value}
              onClick={() => onSettings({ micBackend: b.value })}
              className={`rounded-xl border px-3 py-2.5 text-left flex gap-3 items-start transition-colors ${
                settings.micBackend === b.value
                  ? "border-accent bg-accent/10"
                  : "border-line hover:border-zinc-600"
              }`}
            >
              <span className={settings.micBackend === b.value ? "text-accent-soft mt-0.5" : "text-zinc-400 mt-0.5"}>{b.icon}</span>
              <span>
                <span className="block text-sm text-zinc-100">{b.title}</span>
                <span className="block text-xs text-muted">{b.description}</span>
              </span>
            </button>
          ))}
        </div>
      </Field>

      {native ? (
        <NativeMicSection settings={settings} onSettings={onSettings} onNotify={onNotify} />
      ) : (
        <VirtualCableSection settings={settings} devices={devices} onSettings={onSettings} />
      )}
    </Card>
  );
}

function NativeMicSection({ settings, onSettings, onNotify }: Omit<Props, "devices">) {
  const [state, setState] = useState<NativeMicState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.nativeMicState().then(setState).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = async (guid: string, action: "install" | "uninstall") => {
    setBusy(guid);
    try {
      const message = action === "install" ? await api.installNativeMic(guid) : await api.uninstallNativeMic(guid);
      onNotify("success", message);
    } catch (e) {
      onNotify("error", errorMessage(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const installed = state?.devices.some((d) => d.installed) ?? false;
  const status = !state
    ? { color: "bg-zinc-500", text: "Verificando…" }
    : state.feed.active && installed
      ? { color: "bg-emerald-400", text: "Ativo: os sons estão indo para o microfone" }
      : installed
        ? { color: "bg-amber-400", text: "Instalado: aguardando algum app (Discord, jogo…) usar o microfone" }
        : { color: "bg-zinc-500", text: "Não instalado: escolha seu microfone abaixo" };

  return (
    <>
      <Field label="Status">
        <div className="h-9 flex items-center gap-2.5 text-sm text-zinc-200">
          <span className={`size-2.5 rounded-full ${status.color}`} />
          {status.text}
        </div>
      </Field>

      <Field
        label="Seu microfone"
        hint="Instale no mesmo microfone que você usa no Discord ou no jogo."
      >
        <div className="rounded-xl border border-line divide-y divide-line/70">
          {state?.devices.length === 0 && <p className="px-3 py-3 text-sm text-muted">Nenhum microfone encontrado.</p>}
          {state?.devices.map((d) => (
            <div key={d.guid} className="flex items-center gap-3 px-3 h-12">
              <Mic size={15} className={d.installed ? "text-accent-soft" : "text-zinc-500"} />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm text-zinc-100">{d.name}</div>
                <div className="text-[11px] text-muted">
                  {d.isDefault && "Padrão do Windows"}
                  {d.isDefault && d.installed && " · "}
                  {d.installed && <span className="text-accent-soft">VibePad instalado</span>}
                </div>
              </div>
              {busy === d.guid ? (
                <Loader2 size={16} className="animate-spin text-accent" />
              ) : d.installed ? (
                <button
                  disabled={!!busy}
                  onClick={() => run(d.guid, "uninstall")}
                  className="h-8 px-3 rounded-lg border border-line text-xs text-zinc-300 hover:border-red-500/60 hover:text-red-300 disabled:opacity-40"
                >
                  Remover
                </button>
              ) : (
                <button
                  disabled={!!busy || !state?.dllAvailable}
                  onClick={() => run(d.guid, "install")}
                  className="h-8 px-3 rounded-lg bg-brand text-xs font-medium text-white hover:brightness-110 disabled:opacity-40 flex items-center gap-1.5"
                >
                  <ShieldCheck size={13} /> Instalar
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted mt-2 leading-relaxed">
          Pede permissão de administrador uma vez e reinicia o serviço de áudio do Windows (o som some por alguns segundos).
          {state && !state.dllAvailable && (
            <span className="block text-amber-300 mt-1">Componente do microfone ausente: rode "npm run build:apo".</span>
          )}
        </p>
      </Field>

      <Field label="Bloquear minha voz" hint="Enquanto um som toca, só ele vai para o microfone.">
        <div className="h-9 flex items-center">
          <Toggle label="Bloquear minha voz" checked={settings.blockMic} onChange={(v) => onSettings({ blockMic: v })} />
        </div>
      </Field>

      <p className="text-xs text-muted leading-relaxed">
        Dica: se os sons saírem cortados, desative a <b className="text-zinc-300">supressão de ruído</b> (Krisp) e o{" "}
        <b className="text-zinc-300">cancelamento de eco</b> no Discord ou no app de voz.
      </p>
    </>
  );
}

function VirtualCableSection({ settings, devices, onSettings }: Omit<Props, "onNotify">) {
  const detected = devices.find((d) => d.isVirtual);
  const missing = !(settings.micDevice ? devices.some((d) => d.name === settings.micDevice) : detected);
  return (
    <Field label="Cabo virtual" hint={<>Dispositivo que alimenta o microfone (ex.: <b>CABLE Input</b>).</>}>
      <Select label="Cabo virtual" value={settings.micDevice ?? AUTO} onChange={(v) => onSettings({ micDevice: v === AUTO ? null : v })}>
        <option value={AUTO}>Detectar automaticamente{detected ? ` (${detected.name})` : ""}</option>
        {devices.map((d) => (
          <option key={d.name} value={d.name}>
            {d.name}
          </option>
        ))}
      </Select>
      {missing && (
        <p className="text-xs text-amber-300 mt-2 leading-relaxed">
          Nenhum cabo virtual encontrado. Instale o VB-Audio Virtual Cable ou use o método nativo.
        </p>
      )}
      <p className="text-xs text-muted mt-2 leading-relaxed">
        No Discord ou no jogo, escolha <b className="text-zinc-300">CABLE Output</b> como microfone.
      </p>
    </Field>
  );
}
