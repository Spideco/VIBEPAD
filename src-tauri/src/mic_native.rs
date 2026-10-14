//! Microfone nativo: mixa as vozes destinadas ao microfone e escreve o
//! resultado num anel de memória compartilhada que o APO do VibePad (rodando
//! dentro do audiodg.exe, no microfone do usuário) soma ao sinal da voz.
//!
//! O layout do anel é espelhado de `apo/cpp/mic_ring.h`.

use std::{
    fs::File,
    io::BufReader,
    mem::size_of,
    sync::{
        atomic::{AtomicBool, AtomicI32, AtomicI64, AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use rodio::source::UniformSourceIterator;
use rodio::Decoder;
use serde::Serialize;
use windows::core::w;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_ALL_ACCESS, MEMORY_MAPPED_VIEW_ADDRESS,
};

const MAGIC: u32 = 0x524D_5056; // "VPMR"
const VERSION: u32 = 1;
pub const RATE: u32 = 48_000;
const CHANNELS: usize = 2;
const FRAMES: usize = 65_536;
/// Quanto o escritor fica adiantado em relação ao relógio (~50 ms).
const LEAD_FRAMES: u64 = 2_400;
const MAX_CHUNK: u64 = 4_800;

#[repr(C)]
struct Header {
    magic: u32,
    version: u32,
    rate: u32,
    channels: u32,
    frames: u32,
    _reserved0: u32,
    write_pos: AtomicI64,
    block_mic: AtomicI32,
    active: AtomicI32,
    apo_heartbeat: AtomicI64,
    apo_rate: AtomicI32,
    apo_channels: AtomicI32,
    _reserved: [u8; 72],
}

const _: () = assert!(size_of::<Header>() == 128);
const TOTAL_SIZE: usize = size_of::<Header>() + FRAMES * CHANNELS * size_of::<f32>();

/// Visão mapeada do anel criado pelo APO.
struct Ring {
    handle: HANDLE,
    view: MEMORY_MAPPED_VIEW_ADDRESS,
}

// A memória é compartilhada entre processos; o acesso é feito só pela thread do feed.
unsafe impl Send for Ring {}

impl Ring {
    /// Só abre: quem cria o anel é o APO (o audiodg tem permissão para objetos `Global\`).
    fn open() -> Option<Ring> {
        unsafe {
            let handle = OpenFileMappingW(FILE_MAP_ALL_ACCESS.0, false, w!("Global\\VibePadMicRing_v1")).ok()?;
            let view = MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, TOTAL_SIZE);
            if view.Value.is_null() {
                let _ = CloseHandle(handle);
                return None;
            }
            let ring = Ring { handle, view };
            let header = ring.header();
            let valid = std::ptr::read_volatile(&header.magic) == MAGIC
                && std::ptr::read_volatile(&header.version) == VERSION
                && std::ptr::read_volatile(&header.frames) as usize == FRAMES;
            valid.then_some(ring)
        }
    }

    fn header(&self) -> &Header {
        unsafe { &*(self.view.Value as *const Header) }
    }

    fn write(&self, samples: &[f32], block_mic: bool) {
        let header = self.header();
        let frames = samples.len() / CHANNELS;
        let start = header.write_pos.load(Ordering::Relaxed).max(0) as usize;
        unsafe {
            let data = (self.view.Value as *mut u8).add(size_of::<Header>()) as *mut f32;
            for i in 0..frames {
                let slot = (start + i) % FRAMES;
                *data.add(slot * CHANNELS) = samples[i * CHANNELS];
                *data.add(slot * CHANNELS + 1) = samples[i * CHANNELS + 1];
            }
        }
        // Release: o APO só lê frames abaixo de write_pos depois de vê-lo.
        header.write_pos.store((start + frames) as i64, Ordering::Release);
        header.block_mic.store(block_mic as i32, Ordering::Relaxed);
        header.active.store(1, Ordering::Release);
    }
}

impl Drop for Ring {
    fn drop(&mut self) {
        unsafe {
            self.header().active.store(0, Ordering::Release);
            let _ = UnmapViewOfFile(self.view);
            let _ = CloseHandle(self.handle);
        }
    }
}

struct FeedVoice {
    source: Box<dyn Iterator<Item = f32> + Send>,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
}

/// Controle de uma voz tocando no microfone nativo. Parar = soltar o handle.
pub struct FeedHandle {
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
}

impl FeedHandle {
    pub fn set_volume(&self, volume: f32) {
        self.volume.store(volume.to_bits(), Ordering::Relaxed);
    }

    pub fn is_finished(&self) -> bool {
        self.finished.load(Ordering::Relaxed)
    }
}

impl Drop for FeedHandle {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedStatus {
    /// O anel existe, ou seja, o APO já foi carregado em algum momento.
    pub connected: bool,
    /// O APO está processando áudio agora (algum app está usando o microfone).
    pub active: bool,
    pub mic_rate: u32,
    pub mic_channels: u32,
}

struct Shared {
    voices: Mutex<Vec<FeedVoice>>,
    block_mic: AtomicBool,
    status: Mutex<FeedStatus>,
}

#[derive(Clone)]
pub struct MicFeed {
    shared: Arc<Shared>,
}

impl MicFeed {
    pub fn start() -> Self {
        let shared = Arc::new(Shared {
            voices: Mutex::new(Vec::new()),
            block_mic: AtomicBool::new(false),
            status: Mutex::new(FeedStatus::default()),
        });
        let worker = shared.clone();
        thread::Builder::new()
            .name("vibepad-mic-feed".into())
            .spawn(move || run(worker))
            .expect("falha ao iniciar a thread do microfone nativo");
        Self { shared }
    }

    pub fn play(&self, source: Decoder<BufReader<File>>, volume: f32) -> FeedHandle {
        // Converte para o formato fixo do anel (estéreo, 48 kHz, f32).
        let uniform: UniformSourceIterator<_, f32> = UniformSourceIterator::new(source, CHANNELS as u16, RATE);
        let handle = FeedHandle {
            volume: Arc::new(AtomicU32::new(volume.to_bits())),
            stopped: Arc::new(AtomicBool::new(false)),
            finished: Arc::new(AtomicBool::new(false)),
        };
        self.shared.voices.lock().unwrap().push(FeedVoice {
            source: Box::new(uniform),
            volume: handle.volume.clone(),
            stopped: handle.stopped.clone(),
            finished: handle.finished.clone(),
        });
        handle
    }

    pub fn set_block_mic(&self, block: bool) {
        self.shared.block_mic.store(block, Ordering::Relaxed);
    }

    pub fn status(&self) -> FeedStatus {
        *self.shared.status.lock().unwrap()
    }
}

fn mix(voices: &mut Vec<FeedVoice>, out: &mut [f32]) {
    out.fill(0.0);
    for voice in voices.iter_mut() {
        if voice.stopped.load(Ordering::Relaxed) {
            voice.finished.store(true, Ordering::Relaxed);
            continue;
        }
        let volume = f32::from_bits(voice.volume.load(Ordering::Relaxed));
        for sample in out.iter_mut() {
            match voice.source.next() {
                Some(s) => *sample += s * volume,
                None => {
                    voice.finished.store(true, Ordering::Relaxed);
                    break;
                }
            }
        }
    }
    voices.retain(|v| !v.finished.load(Ordering::Relaxed));
    for sample in out.iter_mut() {
        *sample = sample.clamp(-1.0, 1.0);
    }
}

/// Escreve no anel no ritmo do relógio, mesmo sem o APO conectado — assim as
/// vozes terminam no tempo certo e a interface continua consistente.
fn run(shared: Arc<Shared>) {
    let mut ring: Option<Ring> = None;
    let mut last_attempt: Option<Instant> = None;
    let mut last_heartbeat = 0i64;
    let mut last_beat_at: Option<Instant> = None;

    let clock = Instant::now();
    let mut produced: u64 = 0;
    let mut buffer = vec![0f32; MAX_CHUNK as usize * CHANNELS];

    loop {
        thread::sleep(Duration::from_millis(5));

        if ring.is_none() && last_attempt.map_or(true, |t| t.elapsed() > Duration::from_millis(500)) {
            last_attempt = Some(Instant::now());
            ring = Ring::open();
        }

        let due = (clock.elapsed().as_secs_f64() * RATE as f64) as u64 + LEAD_FRAMES;
        if due > produced + RATE as u64 {
            // A thread ficou parada (ex.: suspensão do PC): não tenta recuperar o atraso.
            produced = due - LEAD_FRAMES;
        }
        let frames = due.saturating_sub(produced).min(MAX_CHUNK) as usize;
        if frames == 0 {
            continue;
        }

        let out = &mut buffer[..frames * CHANNELS];
        let playing = {
            let mut voices = shared.voices.lock().unwrap();
            mix(&mut voices, out);
            !voices.is_empty()
        };
        produced += frames as u64;

        let mut status = FeedStatus::default();
        if let Some(r) = &ring {
            r.write(out, playing && shared.block_mic.load(Ordering::Relaxed));
            let header = r.header();
            let beat = header.apo_heartbeat.load(Ordering::Relaxed);
            if beat != last_heartbeat {
                last_heartbeat = beat;
                last_beat_at = Some(Instant::now());
            }
            status = FeedStatus {
                connected: true,
                active: last_beat_at.is_some_and(|t| t.elapsed() < Duration::from_millis(1500)),
                mic_rate: header.apo_rate.load(Ordering::Relaxed).max(0) as u32,
                mic_channels: header.apo_channels.load(Ordering::Relaxed).max(0) as u32,
            };
        }
        *shared.status.lock().unwrap() = status;
    }
}
