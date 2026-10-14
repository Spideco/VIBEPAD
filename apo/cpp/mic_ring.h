// Protocolo de memória compartilhada entre o VibePad (escritor) e o APO
// carregado pelo audiodg.exe (leitor). O layout é espelhado em
// src-tauri/src/mic_native.rs — qualquer mudança precisa ser feita nos dois.
#pragma once
#include <stdint.h>

#define VPMR_NAME L"Global\\VibePadMicRing_v1"
#define VPMR_MAGIC 0x524D5056u   // "VPMR"
#define VPMR_VERSION 1u
#define VPMR_RATE 48000u         // taxa fixa do anel; o APO converte para a do microfone
#define VPMR_CHANNELS 2u
#define VPMR_FRAMES 65536u       // ~1,36 s de áudio

#pragma pack(push, 8)
struct VpmrHeader
{
    uint32_t magic;
    uint32_t version;
    uint32_t rate;
    uint32_t channels;
    uint32_t frames;
    uint32_t reserved0;
    volatile int64_t writePos;      // frames escritos desde sempre (só cresce) - app
    volatile int32_t blockMic;      // app: 1 = silenciar a voz real enquanto toca
    volatile int32_t active;        // app: 1 = VibePad alimentando o anel
    volatile int64_t apoHeartbeat;  // APO: incrementado a cada bloco processado
    volatile int32_t apoRate;       // APO: taxa do microfone (diagnóstico)
    volatile int32_t apoChannels;   // APO: canais do microfone (diagnóstico)
    uint8_t reserved[72];
};
#pragma pack(pop)

static_assert(sizeof(VpmrHeader) == 128, "VpmrHeader deve ter 128 bytes");

#define VPMR_DATA_OFFSET sizeof(VpmrHeader)
#define VPMR_TOTAL_SIZE (VPMR_DATA_OFFSET + VPMR_FRAMES * VPMR_CHANNELS * sizeof(float))
