use std::{fs::File, io::BufReader, path::Path};

use rodio::{Decoder, Source};

pub struct Analysis {
    pub duration_ms: u64,
    pub peaks: Vec<f32>,
}

/// Decodifica o arquivo inteiro e reduz a amplitude a `bars` picos normalizados (0..1).
pub fn analyze(path: &Path, bars: usize) -> Result<Analysis, String> {
    let file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let decoder = Decoder::new(BufReader::new(file))
        .map_err(|e| format!("{}: formato não suportado ({e})", path.display()))?;

    let channels = decoder.channels().max(1) as u64;
    let rate = decoder.sample_rate().max(1) as u64;
    // Blocos de ~5 ms mantêm a memória baixa mesmo para arquivos longos.
    let block = ((rate * channels) / 200).max(channels) as usize;

    let mut blocks: Vec<f32> = Vec::new();
    let mut current = 0f32;
    let mut in_block = 0usize;
    let mut total: u64 = 0;
    for sample in decoder.convert_samples::<f32>() {
        current = current.max(sample.abs());
        in_block += 1;
        total += 1;
        if in_block == block {
            blocks.push(current);
            current = 0.0;
            in_block = 0;
        }
    }
    if in_block > 0 {
        blocks.push(current);
    }

    let mut peaks = vec![0f32; bars];
    if !blocks.is_empty() {
        let len = blocks.len();
        for (i, peak) in peaks.iter_mut().enumerate() {
            let start = i * len / bars;
            let end = ((i + 1) * len / bars).max(start + 1).min(len);
            *peak = blocks[start..end].iter().copied().fold(0.0, f32::max);
        }
        let max = peaks.iter().copied().fold(0.0, f32::max);
        if max > 0.0 {
            peaks.iter_mut().for_each(|p| *p = (*p / max * 100.0).round() / 100.0);
        }
    }

    Ok(Analysis { duration_ms: total * 1000 / (rate * channels), peaks })
}
