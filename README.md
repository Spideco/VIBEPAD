# VibePad

Soundboard para desktop no estilo Soundpad: atalhos globais, roteamento de áudio para o microfone, waveform e controle de volume. Feito com **Tauri 2 (Rust)** + **React** + **Tailwind CSS 4**.

## Pré-requisitos (Windows)

1. **Rust**: <https://rustup.rs> (instale também o *Microsoft C++ Build Tools* quando solicitado)
2. **Node.js 18+**
3. **WebView2**: já vem no Windows 10/11 atualizado
4. Opcional, para enviar sons ao microfone: **VB-Audio Virtual Cable** (<https://vb-audio.com/Cable/>)

## Rodando

```bash
npm install
npm run tauri dev      # app desktop em modo desenvolvimento
npm run tauri build    # gera o instalador em src-tauri/target/release/bundle
```

`npm run dev` sozinho abre só a interface no navegador, com dados simulados (útil para mexer no visual).

## Como o som chega ao microfone

O VibePad toca cada som em **dois dispositivos ao mesmo tempo**:

| Rota | Dispositivo | Para quê |
|---|---|---|
| Microfone | `CABLE Input` (detectado automaticamente) | Discord, jogos e OBS escutam pelo `CABLE Output` |
| Fones | Saída padrão (ou a que você escolher) | Para você ouvir o que está tocando |

No app de destino, selecione **CABLE Output** como microfone. Para mandar sua voz junto, use *Propriedades do microfone → Escutar → Escutar este dispositivo → CABLE Input*, ou o Voicemeeter.

## Estrutura

```
src/                     React (UI)
  App.tsx                estado, eventos do back-end, atalhos de navegação
  components/            Sidebar, SoundList/SoundRow, Waveform, HotkeyRecorder, Settings…
  lib/api.ts             ponte com os comandos Tauri (cai num mock fora do Tauri)
src-tauri/src/
  audio.rs               thread de áudio (rodio/cpal): uma voz = um Sink por dispositivo
  waveform.rs            decodifica o arquivo e gera 120 picos + duração
  hotkeys.rs             registro de atalhos globais (tauri-plugin-global-shortcut)
  commands.rs            comandos expostos ao front-end
  library.rs             modelo + persistência em %APPDATA%/com.vibepad.app/library.json
```

## Atalhos

- Clique no badge do atalho (ou em **Definir**) e pressione a combinação. `Esc` cancela, `Backspace` remove.
- Se a combinação já pertence a outro som, ela é transferida para o novo.
- Alguns atalhos são reservados pelo Windows (por exemplo, **F12** sozinho). Nesse caso o badge fica amarelo, com a explicação.
- Dentro do app: `↑`/`↓` selecionam, `Enter`/`Espaço` tocam/param e um clique duplo na linha toca o som.

Formatos suportados: MP3, WAV, OGG, FLAC, M4A/AAC.
