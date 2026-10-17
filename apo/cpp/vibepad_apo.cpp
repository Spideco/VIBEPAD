// APO de captura do VibePad: roda dentro do audiodg.exe, no microfone do
// usuário, e soma ao sinal da voz o áudio que o VibePad escreve no anel de
// memória compartilhada (ver mic_ring.h). Se o microfone já tinha um APO do
// fabricante, ele é carregado como "filho" e processado antes.

#include <initguid.h>
#include "vibepad_apo.h"

#include <mmdeviceapi.h>
#include <propvarutil.h>
#include <sddl.h>
#include <string.h>

const CRegAPOProperties<1> VibePadApo::regProperties(
    VIBEPAD_APO_CLSID, L"VibePad Mic", L"VibePad", 1, 0, __uuidof(IAudioProcessingObject),
    (APO_FLAG)(APO_FLAG_FRAMESPERSECOND_MUST_MATCH | APO_FLAG_BITSPERSAMPLE_MUST_MATCH | APO_FLAG_INPLACE));

volatile LONG VibePadApo::instanceCount = 0;

// Atraso alvo entre o que o app escreve e o que o microfone lê, e o máximo
// tolerado antes de ressincronizar (em frames do anel).
static const double TARGET_LAG = 0.06 * VPMR_RATE;
static const double MAX_LAG = 0.25 * VPMR_RATE;
// Correção máxima da velocidade de leitura (0,2% ≈ 3 cents, inaudível) e
// suavização do atraso medido, que oscila conforme o app escreve em rajadas.
static const double MAX_DRIFT = 0.002;
static const double LAG_SMOOTHING = 0.01;
// Quantos blocos (~10 ms cada) esperar entre tentativas de reabrir o anel.
static const UINT32 RING_RETRY_BLOCKS = 100;

VibePadApo::VibePadApo(IUnknown* outerUnknown)
    : CBaseAudioProcessingObject(regProperties), refCount(1), childApo(nullptr), childRt(nullptr), childCfg(nullptr),
      channels(0), sampleRate(48000.0f), ringMapping(nullptr), ring(nullptr), ringData(nullptr), cursor(0),
      lagAverage(0), synced(false), nested(false), retryCounter(0)
{
    outer = outerUnknown ? outerUnknown : reinterpret_cast<IUnknown*>(static_cast<INonDelegatingUnknown*>(this));
    InterlockedIncrement(&instanceCount);
}

VibePadApo::~VibePadApo()
{
    releaseChild();
    closeRing();
    InterlockedDecrement(&instanceCount);
}

// ---- IUnknown / agregação ----

HRESULT VibePadApo::QueryInterface(const IID& iid, void** ppv) { return outer->QueryInterface(iid, ppv); }
ULONG VibePadApo::AddRef() { return outer->AddRef(); }
ULONG VibePadApo::Release() { return outer->Release(); }

HRESULT VibePadApo::NonDelegatingQueryInterface(const IID& iid, void** ppv)
{
    if (!ppv)
        return E_POINTER;
    if (iid == __uuidof(IUnknown))
        *ppv = static_cast<INonDelegatingUnknown*>(this);
    else if (iid == __uuidof(IAudioProcessingObject))
        *ppv = static_cast<IAudioProcessingObject*>(this);
    else if (iid == __uuidof(IAudioProcessingObjectRT))
        *ppv = static_cast<IAudioProcessingObjectRT*>(this);
    else if (iid == __uuidof(IAudioProcessingObjectConfiguration))
        *ppv = static_cast<IAudioProcessingObjectConfiguration*>(this);
    else if (iid == __uuidof(IAudioSystemEffects))
        *ppv = static_cast<IAudioSystemEffects*>(this);
    else
    {
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    reinterpret_cast<IUnknown*>(*ppv)->AddRef();
    return S_OK;
}

ULONG VibePadApo::NonDelegatingAddRef() { return InterlockedIncrement(&refCount); }

ULONG VibePadApo::NonDelegatingRelease()
{
    LONG count = InterlockedDecrement(&refCount);
    if (count == 0)
        delete this;
    return count;
}

// ---- Inicialização e APO filho ----

static bool readChildClsid(const wchar_t* endpointGuid, GUID* clsid)
{
    wchar_t keyPath[256];
    swprintf_s(keyPath, L"%s\\%s", VIBEPAD_CHILD_KEY, endpointGuid);
    wchar_t value[64] = {};
    DWORD size = sizeof(value);
    if (RegGetValueW(HKEY_LOCAL_MACHINE, keyPath, L"Child", RRF_RT_REG_SZ, nullptr, value, &size) != ERROR_SUCCESS)
        return false;
    return value[0] == L'{' && SUCCEEDED(CLSIDFromString(value, clsid)) && *clsid != VIBEPAD_APO_CLSID;
}

void VibePadApo::releaseChild()
{
    if (childCfg) childCfg->Release();
    if (childRt) childRt->Release();
    if (childApo) childApo->Release();
    childCfg = nullptr;
    childRt = nullptr;
    childApo = nullptr;
}

HRESULT VibePadApo::Initialize(UINT32 cbDataSize, BYTE* pbyData)
{
    if ((pbyData == nullptr) != (cbDataSize == 0))
        return E_INVALIDARG;
    if (cbDataSize < sizeof(APOInitSystemEffects))
        return E_INVALIDARG;

    releaseChild();
    APOInitSystemEffects* init = reinterpret_cast<APOInitSystemEffects*>(pbyData);

    wchar_t endpointGuid[64] = {};
    if (init->pAPOEndpointProperties)
    {
        PROPVARIANT var;
        PropVariantInit(&var);
        if (SUCCEEDED(init->pAPOEndpointProperties->GetValue(PKEY_AudioEndpoint_GUID, &var)) && var.vt == VT_LPWSTR)
            wcsncpy_s(endpointGuid, var.pwszVal, _TRUNCATE);
        PropVariantClear(&var);
    }

    // Outro APO encadeador (Equalizer APO, Soundpad) pode ter o VibePad como
    // filho enquanto o VibePad o tem como filho: a criação viraria um laço.
    // Uma instância criada dentro da inicialização de outra (mesma thread) é
    // um elo repetido: não encadeia nada e não mixa, para os sons não dobrarem.
    static thread_local int initDepth = 0;
    nested = initDepth > 0;

    GUID childClsid;
    if (!nested && endpointGuid[0] && readChildClsid(endpointGuid, &childClsid))
    {
        struct DepthGuard
        {
            DepthGuard() { initDepth++; }
            ~DepthGuard() { initDepth--; }
        } depthGuard;
        IAudioProcessingObject* apo = nullptr;
        if (SUCCEEDED(CoCreateInstance(childClsid, nullptr, CLSCTX_INPROC_SERVER, __uuidof(IAudioProcessingObject),
                                       reinterpret_cast<void**>(&apo))))
        {
            // O filho recebe a mesma estrutura, mas com o próprio CLSID.
            BYTE* copy = static_cast<BYTE*>(CoTaskMemAlloc(cbDataSize));
            HRESULT hr = E_OUTOFMEMORY;
            if (copy)
            {
                memcpy(copy, pbyData, cbDataSize);
                reinterpret_cast<APOInitSystemEffects*>(copy)->APOInit.clsid = childClsid;
                hr = apo->Initialize(cbDataSize, copy);
                CoTaskMemFree(copy);
            }
            if (SUCCEEDED(hr) &&
                SUCCEEDED(apo->QueryInterface(__uuidof(IAudioProcessingObjectRT), reinterpret_cast<void**>(&childRt))) &&
                SUCCEEDED(apo->QueryInterface(__uuidof(IAudioProcessingObjectConfiguration), reinterpret_cast<void**>(&childCfg))))
            {
                childApo = apo;
            }
            else
            {
                if (childRt) childRt->Release();
                if (childCfg) childCfg->Release();
                childRt = nullptr;
                childCfg = nullptr;
                apo->Release();
            }
        }
    }

    m_bIsInitialized = true;
    return S_OK;
}

HRESULT VibePadApo::GetLatency(HNSTIME* pTime)
{
    if (!pTime)
        return E_POINTER;
    if (!m_bIsLocked)
        return APOERR_ALREADY_UNLOCKED;
    *pTime = 0;
    if (childApo)
        childApo->GetLatency(pTime);
    return S_OK;
}

HRESULT VibePadApo::IsInputFormatSupported(IAudioMediaType* pOutputFormat, IAudioMediaType* pRequestedInputFormat,
                                           IAudioMediaType** ppSupportedInputFormat)
{
    if (childApo)
    {
        HRESULT hr = childApo->IsInputFormatSupported(pOutputFormat, pRequestedInputFormat, ppSupportedInputFormat);
        if (SUCCEEDED(hr))
            return hr;
    }
    return CBaseAudioProcessingObject::IsInputFormatSupported(pOutputFormat, pRequestedInputFormat, ppSupportedInputFormat);
}

HRESULT VibePadApo::LockForProcess(UINT32 u32NumInputConnections, APO_CONNECTION_DESCRIPTOR** ppInputConnections,
                                   UINT32 u32NumOutputConnections, APO_CONNECTION_DESCRIPTOR** ppOutputConnections)
{
    UNCOMPRESSEDAUDIOFORMAT format;
    HRESULT hr = ppOutputConnections[0]->pFormat->GetUncompressedAudioFormat(&format);
    if (FAILED(hr))
        return hr;

    if (childCfg)
    {
        hr = childCfg->LockForProcess(u32NumInputConnections, ppInputConnections, u32NumOutputConnections, ppOutputConnections);
        if (FAILED(hr))
            releaseChild();   // segue sem o filho em vez de derrubar o microfone
    }

    hr = CBaseAudioProcessingObject::LockForProcess(u32NumInputConnections, ppInputConnections, u32NumOutputConnections,
                                                    ppOutputConnections);
    if (FAILED(hr))
        return hr;

    channels = format.dwSamplesPerFrame;
    sampleRate = format.fFramesPerSecond > 0 ? format.fFramesPerSecond : 48000.0f;
    synced = false;
    openRing();
    return hr;
}

HRESULT VibePadApo::UnlockForProcess()
{
    if (childCfg)
        childCfg->UnlockForProcess();
    closeRing();
    return CBaseAudioProcessingObject::UnlockForProcess();
}

// ---- Anel de memória compartilhada ----

void VibePadApo::openRing()
{
    if (ring)
        return;

    // Qualquer usuário (e apps com integridade baixa) pode abrir; o audiodg
    // roda como LocalService e tem o privilégio de criar objetos Global\.
    PSECURITY_DESCRIPTOR sd = nullptr;
    ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:(A;;GA;;;WD)(A;;GA;;;SY)(A;;GA;;;LS)(A;;GA;;;AC)S:(ML;;NW;;;LW)",
                                                         SDDL_REVISION_1, &sd, nullptr);
    SECURITY_ATTRIBUTES sa = {sizeof(sa), sd, FALSE};

    HANDLE mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, sd ? &sa : nullptr, PAGE_READWRITE, 0,
                                        (DWORD)VPMR_TOTAL_SIZE, VPMR_NAME);
    if (!mapping)
        mapping = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, VPMR_NAME);
    if (sd)
        LocalFree(sd);
    if (!mapping)
        return;

    void* view = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, VPMR_TOTAL_SIZE);
    if (!view)
    {
        CloseHandle(mapping);
        return;
    }

    VpmrHeader* header = static_cast<VpmrHeader*>(view);
    if (header->magic == 0)
    {
        header->version = VPMR_VERSION;
        header->rate = VPMR_RATE;
        header->channels = VPMR_CHANNELS;
        header->frames = VPMR_FRAMES;
        MemoryBarrier();
        InterlockedCompareExchange(reinterpret_cast<volatile LONG*>(&header->magic), (LONG)VPMR_MAGIC, 0);
    }
    if (header->magic != VPMR_MAGIC || header->version != VPMR_VERSION || header->frames != VPMR_FRAMES)
    {
        UnmapViewOfFile(view);
        CloseHandle(mapping);
        return;
    }

    header->apoRate = (int32_t)sampleRate;
    header->apoChannels = (int32_t)channels;
    ringMapping = mapping;
    ring = header;
    ringData = reinterpret_cast<const float*>(static_cast<BYTE*>(view) + VPMR_DATA_OFFSET);
}

void VibePadApo::closeRing()
{
    if (ring)
        UnmapViewOfFile(ring);
    if (ringMapping)
        CloseHandle(ringMapping);
    ring = nullptr;
    ringData = nullptr;
    ringMapping = nullptr;
}

#pragma AVRT_CODE_BEGIN

bool VibePadApo::mixRing(float* frames, UINT32 frameCount)
{
    if (!ring)
    {
        if (++retryCounter < RING_RETRY_BLOCKS)
            return false;
        retryCounter = 0;
        openRing();
        if (!ring)
            return false;
    }

    InterlockedIncrement64(&ring->apoHeartbeat);
    if (!ring->active || channels == 0)
    {
        synced = false;
        return false;
    }

    const double writePos = (double)ring->writePos;   // leitura volátil = acquire no MSVC
    if (!synced || cursor > writePos || writePos - cursor > MAX_LAG)
    {
        cursor = writePos > TARGET_LAG ? writePos - TARGET_LAG : 0;
        lagAverage = TARGET_LAG;
        synced = true;
    }

    // O app escreve no ritmo do relógio do PC e o microfone consome no ritmo
    // do cristal dele; os dois nunca batem. Sem correção o cursor encosta em
    // writePos (picotes) ou se afasta até ressincronizar (estalo).
    lagAverage += (writePos - cursor - lagAverage) * LAG_SMOOTHING;
    double drift = (lagAverage - TARGET_LAG) / TARGET_LAG * MAX_DRIFT;
    drift = drift > MAX_DRIFT ? MAX_DRIFT : (drift < -MAX_DRIFT ? -MAX_DRIFT : drift);
    const double step = (double)VPMR_RATE / sampleRate * (1.0 + drift);

    const bool blockVoice = ring->blockMic != 0;
    bool wrote = blockVoice;
    for (UINT32 i = 0; i < frameCount; i++)
    {
        float left = 0, right = 0;
        const double pos = cursor + i * step;
        if (pos + 1 < writePos)
        {
            const int64_t index = (int64_t)pos;
            const float frac = (float)(pos - (double)index);
            const float* a = ringData + (index % VPMR_FRAMES) * VPMR_CHANNELS;
            const float* b = ringData + ((index + 1) % VPMR_FRAMES) * VPMR_CHANNELS;
            left = a[0] + (b[0] - a[0]) * frac;
            right = a[1] + (b[1] - a[1]) * frac;
        }

        float* frame = frames + (size_t)i * channels;
        if (blockVoice)
            memset(frame, 0, channels * sizeof(float));
        if (channels == 1)
        {
            frame[0] += 0.5f * (left + right);
        }
        else
        {
            frame[0] += left;
            frame[1] += right;
        }
        if (left != 0 || right != 0)
            wrote = true;
    }

    const double next = cursor + frameCount * step;
    cursor = next < writePos ? next : writePos;
    return wrote;
}

void VibePadApo::APOProcess(UINT32 u32NumInputConnections, APO_CONNECTION_PROPERTY** ppInputConnections,
                            UINT32 u32NumOutputConnections, APO_CONNECTION_PROPERTY** ppOutputConnections)
{
    APO_CONNECTION_PROPERTY* input = ppInputConnections[0];
    APO_CONNECTION_PROPERTY* output = ppOutputConnections[0];
    if (input->u32BufferFlags != BUFFER_VALID && input->u32BufferFlags != BUFFER_SILENT)
        return;

    float* inFrames = reinterpret_cast<float*>(input->pBuffer);
    float* outFrames = reinterpret_cast<float*>(output->pBuffer);
    const UINT32 frameCount = input->u32ValidFrameCount;
    const size_t bytes = (size_t)frameCount * channels * sizeof(float);

    if (input->u32BufferFlags == BUFFER_SILENT)
        memset(inFrames, 0, bytes);

    if (childRt)
    {
        childRt->APOProcess(u32NumInputConnections, ppInputConnections, u32NumOutputConnections, ppOutputConnections);
        if (output->u32BufferFlags == BUFFER_SILENT)
            memset(outFrames, 0, bytes);
    }
    else
    {
        if (outFrames != inFrames)
            memcpy(outFrames, inFrames, bytes);
        output->u32ValidFrameCount = frameCount;
        output->u32BufferFlags = input->u32BufferFlags;
    }

    if (!nested && mixRing(outFrames, output->u32ValidFrameCount))
        output->u32BufferFlags = BUFFER_VALID;
}

#pragma AVRT_CODE_END
