import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { api, AUDIO_EXTENSIONS, errorMessage, isTauri } from "./lib/api";
import type { DeviceInfo, Settings, Snapshot, Sound, View } from "./lib/types";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { SoundList, type SortKey } from "./components/SoundList";
import { HotkeysView } from "./components/HotkeysView";
import { SettingsView } from "./components/SettingsView";
import { HotkeyRecorder, type RecordTarget } from "./components/HotkeyRecorder";
import { Toasts, useToasts } from "./components/Toasts";
import { hotkeyEquals } from "./lib/hotkey";

/** Agrupa chamadas frequentes (ex.: arrastar um slider) numa só após `ms`. */
function useDebounced<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timers = useRef(new Map<string, number>());
  return useCallback(
    (key: string, ...args: A) => {
      clearTimeout(timers.current.get(key));
      timers.current.set(key, window.setTimeout(() => fnRef.current(...args), ms));
    },
    [ms],
  );
}

export default function App() {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [hotkeyErrors, setHotkeyErrors] = useState<Record<string, string>>({});
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  const [startedAt, setStartedAt] = useState<Record<string, number>>({});
  const [view, setView] = useState<View>("library");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("added");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recording, setRecording] = useState<RecordTarget | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const fail = useCallback((e: unknown) => push("error", errorMessage(e)), [push]);

  const applySnapshot = useCallback((s: Snapshot) => {
    setSounds(s.sounds);
    setSettings(s.settings);
    setHotkeyErrors(s.hotkeyErrors);
  }, []);

  const refreshDevices = useCallback(() => {
    api.listOutputDevices().then(setDevices).catch(fail);
  }, [fail]);

  // Carga inicial + eventos do back-end
  useEffect(() => {
    api.getState().then(applySnapshot).catch(fail);
    refreshDevices();
    const subs = [
      api.onPlaybackState((ids) => setPlaying(new Set(ids))),
      api.onPlaybackStarted((id) => setStartedAt((s) => ({ ...s, [id]: performance.now() }))),
      api.onAudioError((msg) => push("error", msg)),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, [applySnapshot, refreshDevices, fail, push]);

  // ---- Adicionar sons ----
  const addPaths = useCallback(
    async (paths: string[]) => {
      const audio = paths.filter((p) => AUDIO_EXTENSIONS.includes(p.split(".").pop()?.toLowerCase() ?? ""));
      if (audio.length === 0) {
        if (paths.length) push("error", "Nenhum arquivo de áudio suportado (MP3, WAV, OGG, FLAC, M4A).");
        return;
      }
      const busy = push("busy", `Analisando ${audio.length} ${audio.length === 1 ? "arquivo" : "arquivos"}…`);
      try {
        const added = await api.addSounds(audio);
        setSounds((s) => [...s, ...added]);
        if (added.length) {
          push("success", `${added.length} ${added.length === 1 ? "som adicionado" : "sons adicionados"}`);
          setSelectedId(added[0].id);
        } else push("success", "Esses sons já estão na biblioteca");
      } catch (e) {
        fail(e);
      } finally {
        dismiss(busy);
      }
    },
    [push, dismiss, fail],
  );

  const pickFiles = useCallback(async () => {
    if (!isTauri) return push("error", "Abra pelo app (npm run tauri dev) para adicionar arquivos.");
    try {
      addPaths(await api.pickAudioFiles());
    } catch (e) {
      fail(e);
    }
  }, [addPaths, push, fail]);

  // Arrastar e soltar arquivos na janela
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((e) => {
          if (e.payload.type === "enter" || e.payload.type === "over") setDragOver(true);
          else if (e.payload.type === "leave") setDragOver(false);
          else if (e.payload.type === "drop") {
            setDragOver(false);
            addPaths(e.payload.paths);
          }
        })
        .then((un) => (unlisten = un)),
    );
    return () => unlisten?.();
  }, [addPaths]);

  // ---- Ações de som ----
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const toggle = useCallback(
    (id: string) => {
      setSelectedId(id);
      (playingRef.current.has(id) ? api.stopSound(id) : api.playSound(id)).catch(fail);
    },
    [fail],
  );

  const patchLocal = (id: string, patch: Partial<Sound>) =>
    setSounds((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const commitVolume = useDebounced((id: string, volume: number) => {
    api.updateSound(id, { volume }).catch(fail);
  }, 200);

  const actions = useMemo(
    () => ({
      onSelect: setSelectedId,
      onToggle: toggle,
      onFavorite: (id: string, favorite: boolean) => {
        patchLocal(id, { favorite });
        api.updateSound(id, { favorite }).catch(fail);
      },
      onVolume: (id: string, volume: number) => {
        patchLocal(id, { volume });
        commitVolume(id, id, volume);
      },
      onRename: (id: string, name: string) => {
        patchLocal(id, { name });
        api.updateSound(id, { name }).catch(fail);
      },
      onEditHotkey: (id: string) => {
        const s = sounds.find((x) => x.id === id);
        if (s) setRecording({ soundId: id, label: s.name, current: s.hotkey });
      },
      onClearHotkey: (id: string) => {
        api.setHotkey(id, null).then(applySnapshot).catch(fail);
      },
      onRemove: (id: string) => {
        setSounds((list) => list.filter((s) => s.id !== id));
        setSelectedId((sel) => (sel === id ? null : sel));
        api.removeSound(id).catch(fail);
      },
    }),
    [toggle, fail, commitVolume, sounds, applySnapshot],
  );

  // ---- Configurações ----
  const commitSettings = useDebounced((next: Settings) => {
    api.updateSettings(next).then(applySnapshot).catch((e) => {
      fail(e);
      api.getState().then(applySnapshot);
    });
  }, 150);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        commitSettings("settings", next);
        return next;
      });
    },
    [commitSettings],
  );

  const editStopHotkey = () =>
    setRecording({ soundId: null, label: "Parar todos os sons", current: settings?.stopHotkey ?? null });

  const saveHotkey = async (accelerator: string | null) => {
    if (!recording || !settings) return;
    try {
      const snap = recording.soundId
        ? await api.setHotkey(recording.soundId, accelerator)
        : await api.updateSettings({ ...settings, stopHotkey: accelerator });
      applySnapshot(snap);
    } catch (e) {
      fail(e);
      throw e;
    }
  };

  const findConflict = (accelerator: string) => {
    if (settings?.stopHotkey && hotkeyEquals(settings.stopHotkey, accelerator) && recording?.soundId)
      return "Parar todos os sons";
    const other = sounds.find((s) => s.id !== recording?.soundId && s.hotkey && hotkeyEquals(s.hotkey, accelerator));
    return other?.name ?? null;
  };

  const closeRecorder = useCallback(() => setRecording(null), []);

  // ---- Lista visível ----
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = view === "favorites" ? sounds.filter((s) => s.favorite) : sounds;
    if (q) list = list.filter((s) => s.name.toLowerCase().includes(q) || s.hotkey?.toLowerCase().includes(q));
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    if (sort === "duration") sorted.sort((a, b) => a.durationMs - b.durationMs);
    if (sort === "hotkey") sorted.sort((a, b) => Number(!a.hotkey) - Number(!b.hotkey));
    return sorted;
  }, [sounds, view, query, sort]);

  // Navegação por teclado dentro do app: ↑/↓ seleciona, Enter/Espaço toca.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (recording || (view !== "library" && view !== "favorites")) return;
      if ((e.target as HTMLElement).closest("input,select,textarea")) return;
      const idx = visible.findIndex((s) => s.id === selectedId);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = visible[Math.max(0, Math.min(visible.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) setSelectedId(next.id);
      } else if ((e.key === "Enter" || e.key === " ") && selectedId) {
        e.preventDefault();
        toggle(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, view, visible, selectedId, toggle]);

  if (!settings) {
    return <div className="h-full bg-base" />;
  }

  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-deep">

      <TitleBar />

      <div className="flex-1 flex min-h-0 gap-4 pl-5">
        <div className="pb-5 flex">
          <Sidebar
            view={view}
            onView={setView}
            onAdd={pickFiles}
            settings={settings}
            onSettings={updateSettings}
            counts={{ library: sounds.length, favorites: sounds.filter((s) => s.favorite).length }}
          />
        </div>

        <main className="flex-1 min-w-0 relative z-10 rounded-tl-2xl bg-base border-l border-t border-white/[0.06] shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.6)]">
          {(view === "library" || view === "favorites") && (
            <SoundList
              title={view === "library" ? "Minha Biblioteca" : "Favoritos"}
              sounds={visible}
              totalCount={sounds.length}
              favoritesMode={view === "favorites"}
              query={query}
              onQuery={setQuery}
              sort={sort}
              onSort={setSort}
              selectedId={selectedId}
              playing={playing}
              startedAt={startedAt}
              hotkeyErrors={hotkeyErrors}
              onStopAll={() => api.stopAll().catch(fail)}
              onAdd={pickFiles}
              {...actions}
            />
          )}
          {view === "hotkeys" && (
            <HotkeysView
              sounds={sounds}
              settings={settings}
              hotkeyErrors={hotkeyErrors}
              onPlay={toggle}
              onEdit={(id) => (id ? actions.onEditHotkey(id) : editStopHotkey())}
              onClear={(id) => (id ? actions.onClearHotkey(id) : updateSettings({ stopHotkey: null }))}
            />
          )}
          {view === "settings" && (
            <SettingsView
              settings={settings}
              devices={devices}
              hotkeyErrors={hotkeyErrors}
              onSettings={updateSettings}
              onRefreshDevices={refreshDevices}
              onEditStopHotkey={editStopHotkey}
              onNotify={push}
            />
          )}

          {dragOver && (
            <div className="absolute inset-3 z-40 rounded-2xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-sm grid place-items-center pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-accent-soft">
                <Upload size={34} />
                <span className="font-medium">Solte para adicionar à biblioteca</span>
              </div>
            </div>
          )}
        </main>
      </div>

      {recording && (
        <HotkeyRecorder target={recording} findConflict={findConflict} onSave={saveHotkey} onClose={closeRecorder} />
      )}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
