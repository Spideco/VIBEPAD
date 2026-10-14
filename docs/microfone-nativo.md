# Microfone nativo (sem cabo virtual)

Objetivo: tocar os sons **no próprio microfone do usuário**, sem pedir para
instalar VB-Cable/Voicemeeter e sem trocar o microfone no Discord ou no jogo,
como o Soundpad faz.

## Como o Soundpad faz

O Soundpad não cria um microfone novo. Ele se **instala no dispositivo de
gravação** que já existe ("Soundpad gets installed on your default recording
device"). Os indícios apontam para um **APO** (*Audio Processing Object*), o
mecanismo oficial do Windows para efeitos de áudio:

- a instalação exige administrador, e a primeira execução instala uma "extensão
  de driver de áudio" que pede reinício;
- no Windows 7/8 ele exige marcar *Disable Windows Audio DRM Validation*, que é
  justamente o requisito para o `audiodg.exe` carregar APOs sem assinatura;
- existem "modos de instalação" e um "teste de configuração" por microfone, o
  mesmo conceito de *pre-mix/post-mix* do Equalizer APO;
- os testes de microfone do próprio Windows "podem não mostrar os sons", porque
  usam o modo *raw*, que ignora os efeitos.

O **Equalizer APO** (código aberto) usa a mesma técnica no Windows 10/11 e
serviu de referência para os detalhes de registro.

Alternativas descartadas:

| Abordagem | Por que não |
|---|---|
| Driver de microfone virtual próprio | Exige driver em modo kernel assinado pela Microsoft (certificado EV + atestação), e o usuário ainda teria de trocar o microfone nos apps. |
| Injeção de DLL no Discord/jogo | Anticheats (Vanguard, EAC, VAC) tratam injeção como trapaça, com risco real de banimento. |
| Embutir o instalador do VB-Cable | A licença não permite redistribuir, e o problema de "outro microfone" continua. |

## Arquitetura

```
 VibePad.exe                                   audiodg.exe (serviço de áudio)
┌───────────────────────────┐                ┌──────────────────────────────────┐
│ audio.rs  ──► mic_native  │  memória       │ microfone ─► [APO do fabricante] │
│ (decodifica, │  mixa em   │  compartilhada │            ─► VibePad APO ──► apps│
│  volume)     │  48 kHz    │ ─────────────► │               (soma o anel)       │
└──────────────┴────────────┘ Global\Vibe…   └──────────────────────────────────┘
```

1. **`apo/` (C++, DLL `vibepad_mic.dll`)**: APO de efeito de stream (SFX)
   baseado na `CBaseAudioProcessingObject` do Windows SDK. Implementa
   agregação COM, que o audiodg exige. Em cada bloco de ~10 ms ele lê o anel,
   converte de 48 kHz para a taxa do microfone (interpolação linear) e soma ao
   sinal da voz. Se o microfone já tinha um APO do fabricante (supressão de
   ruído da Realtek, por exemplo), ele é carregado como filho e processado
   antes. O anel é criado pelo próprio APO, porque o audiodg roda como
   LocalService e pode criar objetos `Global\`.
2. **Anel de memória** (`apo/cpp/mic_ring.h` ↔ `src-tauri/src/mic_native.rs`):
   cabeçalho de 128 bytes e 65 536 quadros estéreo `f32` a 48 kHz. O app escreve
   no ritmo do relógio, ~50 ms adiantado; cada instância do APO lê com um cursor
   próprio, mira ~60 ms de atraso e ressincroniza acima de 250 ms. Flags:
   `active`, `blockMic` (silenciar a voz enquanto toca) e `apoHeartbeat`, que
   permite à interface saber se o APO está rodando.
3. **Instalador** (`src-tauri/src/mic_setup.rs`): o VibePad se reexecuta como
   administrador (`--mic-setup install <guid> <dll> <resultado>`) e então:
   - copia a DLL para `%ProgramFiles%\VibePad\Mic\`, já que a pasta do usuário
     não é legível pelo serviço de áudio;
   - chama `DllRegisterServer`, que registra o COM e o APO
     (`HKLM\SOFTWARE\Classes\AudioEngine\AudioProcessingObjects`);
   - em `MMDevices\Audio\Capture\{guid}\FxProperties`, coloca o CLSID do APO no
     slot SFX (`{d04e05a6…},5`), no LFX em drivers legados ou no fim da lista
     multi-SFX (`,13`) em drivers novos. Se o acesso for negado, os
     Administradores assumem a posse da chave, como faz o Equalizer APO;
   - liga os "aprimoramentos de áudio" do dispositivo;
   - guarda o estado original em `HKLM\SOFTWARE\VibePad\MicApo\{guid}`, usado
     para encadear o APO original e para restaurar tudo na remoção;
   - reinicia o serviço `Audiosrv`.

## Limitações conhecidas

- Apps que abrem o microfone em modo **raw** ou **exclusivo** não passam pelos
  efeitos e não recebem os sons. Isso inclui o teste de microfone do Windows,
  mas não o Discord, o Teams nem a maioria dos jogos. O Soundpad tem a mesma
  limitação.
- A supressão de ruído e o cancelamento de eco do app de voz (como o Krisp no
  Discord) podem cortar os sons.
- Alguns drivers com APOs proprietários podem recusar o encadeamento. A próxima
  etapa é um "teste de configuração" que toca um tom e confere o heartbeat.
- Só Windows 10/11 por enquanto. No 7/8 seria preciso `DisableProtectedAudioDG`.

## Estado e próximos passos

- [x] APO em C++ compilando sem dependências extras (só DLLs do sistema)
- [x] Anel de memória e mixer no app, com o volume e o "bloquear voz" ligados
- [x] Instalação e remoção elevadas com backup, e interface em Configurações
- [ ] Testar em hardware real (Realtek, USB, headsets com APO próprio)
- [ ] Teste de configuração automático (tom de teste + verificação)
- [ ] Remover a DLL e o registro COM ao desinstalar o VibePad (hook do NSIS)
- [ ] Assinar a DLL e o instalador para evitar alertas do SmartScreen e de antivírus
