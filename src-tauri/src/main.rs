// Evita abrir um console extra no Windows em builds de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `vibepad.exe --mic-setup ...`: instalador elevado do microfone nativo, sem janela.
    let args: Vec<String> = std::env::args().collect();
    if let Some(code) = vibepad_lib::mic_setup::run_cli(&args) {
        std::process::exit(code);
    }
    vibepad_lib::run()
}
