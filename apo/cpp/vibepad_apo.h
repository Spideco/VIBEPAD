#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioenginebaseapo.h>
#include <baseaudioprocessingobject.h>

#include "mic_ring.h"

// {ADE29FAA-683E-43F2-8906-D454CE2DCAD3}
static const GUID VIBEPAD_APO_CLSID = {0xade29faa, 0x683e, 0x43f2, {0x89, 0x06, 0xd4, 0x54, 0xce, 0x2d, 0xca, 0xd3}};

// Onde o instalador guarda o APO original de cada microfone, para encadeá-lo.
#define VIBEPAD_CHILD_KEY L"SOFTWARE\\VibePad\\MicApo"

// O audiodg cria os APOs com agregação COM, então precisamos do par
// IUnknown "delegante" / "não delegante".
struct INonDelegatingUnknown
{
    virtual HRESULT __stdcall NonDelegatingQueryInterface(const IID& iid, void** ppv) = 0;
    virtual ULONG __stdcall NonDelegatingAddRef() = 0;
    virtual ULONG __stdcall NonDelegatingRelease() = 0;
};

class VibePadApo : public CBaseAudioProcessingObject, public IAudioSystemEffects, public INonDelegatingUnknown
{
public:
    explicit VibePadApo(IUnknown* outer);
    virtual ~VibePadApo();

    // IUnknown (delega para o objeto externo)
    HRESULT __stdcall QueryInterface(const IID& iid, void** ppv) override;
    ULONG __stdcall AddRef() override;
    ULONG __stdcall Release() override;

    // INonDelegatingUnknown
    HRESULT __stdcall NonDelegatingQueryInterface(const IID& iid, void** ppv) override;
    ULONG __stdcall NonDelegatingAddRef() override;
    ULONG __stdcall NonDelegatingRelease() override;

    // IAudioProcessingObject
    HRESULT __stdcall Initialize(UINT32 cbDataSize, BYTE* pbyData) override;
    HRESULT __stdcall GetLatency(HNSTIME* pTime) override;
    HRESULT __stdcall IsInputFormatSupported(IAudioMediaType* pOutputFormat, IAudioMediaType* pRequestedInputFormat,
                                             IAudioMediaType** ppSupportedInputFormat) override;

    // IAudioProcessingObjectConfiguration
    HRESULT __stdcall LockForProcess(UINT32 u32NumInputConnections, APO_CONNECTION_DESCRIPTOR** ppInputConnections,
                                     UINT32 u32NumOutputConnections, APO_CONNECTION_DESCRIPTOR** ppOutputConnections) override;
    HRESULT __stdcall UnlockForProcess() override;

    // IAudioProcessingObjectRT
    void __stdcall APOProcess(UINT32 u32NumInputConnections, APO_CONNECTION_PROPERTY** ppInputConnections,
                              UINT32 u32NumOutputConnections, APO_CONNECTION_PROPERTY** ppOutputConnections) override;

    static const CRegAPOProperties<1> regProperties;
    static volatile LONG instanceCount;

private:
    void releaseChild();
    void openRing();
    void closeRing();
    // Soma o anel ao buffer; retorna true se escreveu algo audível.
    bool mixRing(float* frames, UINT32 frameCount);

    volatile LONG refCount;
    IUnknown* outer;

    // APO original do driver (ex.: supressão de ruído da Realtek), se houver.
    IAudioProcessingObject* childApo;
    IAudioProcessingObjectRT* childRt;
    IAudioProcessingObjectConfiguration* childCfg;

    UINT32 channels;
    float sampleRate;

    HANDLE ringMapping;
    VpmrHeader* ring;
    const float* ringData;
    double cursor;   // posição de leitura (em frames do anel), por instância
    bool synced;
    UINT32 retryCounter;
};
