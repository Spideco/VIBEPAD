<p align="center">
  <img src="app-icon.svg" width="96" alt="Ícone do VibePad">
</p>

<h1 align="center">VibePad</h1>

<p align="center">
  <strong>Toque sons direto no seu microfone, com um atalho de teclado.</strong><br>
  Um soundboard para Windows, no estilo do Soundpad, para usar no Discord, nos jogos e nas lives.
</p>

<p align="center">
  <a href="https://github.com/Spideco/VIBEPAD/releases/latest"><strong>⬇ Baixar a versão mais recente</strong></a>
</p>

![Biblioteca de sons do VibePad, com um som tocando](docs/screenshots/biblioteca.png)

## O que é o VibePad

O VibePad é um aplicativo para tocar efeitos sonoros, memes e músicas **no seu microfone**: quem está na call ou no jogo com você escuta o som como se fosse a sua voz. Você também ouve tudo nos seus fones, para saber o que está tocando.

Você monta a sua biblioteca de sons, define um atalho para cada um e dispara os sons a qualquer momento, mesmo com o VibePad minimizado e você no meio de uma partida.

## Destaques

- **Direto no seu microfone:** sem instalar cabo virtual e sem trocar o microfone no Discord ou no jogo. É só escolher o microfone que você já usa e clicar em **Instalar**.
- **Atalhos globais:** cada som pode ter a sua tecla ou combinação, e elas funcionam mesmo com o app em segundo plano. Tem também um atalho para **parar todos os sons**.
- **Barra de reprodução:** pause, continue e pule para qualquer parte do som, como num player de vídeo.
- **Controle de volume:** volume geral, volume de cada som e um volume separado só para os seus fones.
- **Biblioteca organizada:** busca, favoritos e ordenação. É só arrastar os arquivos para a janela para adicionar.
- **Convive com outros apps de áudio:** funciona junto com o Equalizer APO e mantém a sua supressão de ruído funcionando na sua voz.
- **Formatos comuns:** MP3, WAV, OGG, FLAC e M4A.

## Telas

| Teclas de atalho | Configurações do microfone |
|---|---|
| ![Lista de atalhos de teclado do VibePad](docs/screenshots/atalhos.png) | ![Configurações do microfone nativo do VibePad](docs/screenshots/configuracoes.png) |

## Como começar

1. **Baixe e instale** o VibePad pela [página de versões](https://github.com/Spideco/VIBEPAD/releases/latest). O arquivo recomendado é o `VibePad_x.y.z_x64-setup.exe`.
2. **Adicione seus sons** com o botão **Adicionar Som** ou arrastando os arquivos para a janela.
3. **Instale no seu microfone:** em **Configurações → Microfone**, clique em **Instalar** ao lado do microfone que você usa no Discord ou no jogo. O Windows vai pedir permissão de administrador uma vez.
4. **Defina os atalhos:** clique em **Definir** ao lado de um som e aperte a tecla ou combinação que quiser.
5. Pronto: aperte o atalho durante a call ou o jogo e todo mundo vai ouvir.

## Dúvidas comuns

**O Windows mostrou "editor desconhecido" ao instalar.**
O VibePad ainda não tem assinatura digital. Clique em **Mais informações → Executar assim mesmo**.

**Testei no microfone do Windows e os sons não aparecem.**
O teste de microfone do próprio Windows ignora os efeitos de áudio, então ele não mostra os sons. Teste pelo Discord, por um gravador ou pelo jogo.

**Os sons saem cortados ou baixos para os outros.**
A supressão de ruído (como o Krisp) e o cancelamento de eco do Discord podem confundir os sons com barulho. Desative essas opções no app de voz.

**Quero que só o som vá para o microfone, sem a minha voz.**
Ative **Bloquear minha voz** em **Configurações → Microfone**. Enquanto um som estiver tocando, só ele vai para o microfone.

**Uso o Soundpad. Posso usar os dois?**
Não é recomendado usar os dois no mesmo microfone. O VibePad funciona sem travar se o Soundpad estiver instalado, mas o ideal é escolher um.

## Requisitos

- Windows 10 ou 11 (64 bits)

---

<sub>Para desenvolvedores: `npm install` e `npm run tauri dev` para rodar, `npm run tauri build` para gerar o instalador (requer Rust e Node.js). Os detalhes do microfone nativo estão em [docs/microfone-nativo.md](docs/microfone-nativo.md).</sub>
