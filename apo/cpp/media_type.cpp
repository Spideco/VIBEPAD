// Implementação própria de CreateAudioMediaTypeFromUncompressedAudioFormat.
// A versão do SDK (audiomediatypecrt.lib) depende da ATL, que não vem no
// Build Tools padrão; a classe base dos APOs só usa esta função para sugerir
// um formato alternativo quando o pedido não é suportado.

#include <windows.h>
#include <mmreg.h>
#include <ks.h>
#include <ksmedia.h>
#include <audiomediatype.h>
#include <new>
#include <string.h>

namespace
{
class UncompressedMediaType : public IAudioMediaType
{
public:
    explicit UncompressedMediaType(const UNCOMPRESSEDAUDIOFORMAT& format) : format(format)
    {
        memset(&wave, 0, sizeof(wave));
        wave.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
        wave.Format.nChannels = (WORD)format.dwSamplesPerFrame;
        wave.Format.nSamplesPerSec = (DWORD)format.fFramesPerSecond;
        wave.Format.wBitsPerSample = (WORD)(format.dwBytesPerSampleContainer * 8);
        wave.Format.nBlockAlign = (WORD)(format.dwSamplesPerFrame * format.dwBytesPerSampleContainer);
        wave.Format.nAvgBytesPerSec = wave.Format.nSamplesPerSec * wave.Format.nBlockAlign;
        wave.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
        wave.Samples.wValidBitsPerSample = (WORD)format.dwValidBitsPerSample;
        wave.dwChannelMask = format.dwChannelMask;
        wave.SubFormat = format.guidFormatType;
    }

    HRESULT __stdcall QueryInterface(const IID& iid, void** ppv) override
    {
        if (!ppv)
            return E_POINTER;
        if (iid == __uuidof(IUnknown) || iid == __uuidof(IAudioMediaType))
        {
            *ppv = static_cast<IAudioMediaType*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG __stdcall AddRef() override { return InterlockedIncrement(&refCount); }
    ULONG __stdcall Release() override
    {
        LONG count = InterlockedDecrement(&refCount);
        if (count == 0)
            delete this;
        return count;
    }

    HRESULT __stdcall IsCompressedFormat(BOOL* compressed) override
    {
        if (!compressed)
            return E_POINTER;
        *compressed = FALSE;
        return S_OK;
    }

    HRESULT __stdcall IsEqual(IAudioMediaType* other, DWORD* flags) override
    {
        if (!other || !flags)
            return E_POINTER;
        *flags = 0;
        UNCOMPRESSEDAUDIOFORMAT o;
        if (FAILED(other->GetUncompressedAudioFormat(&o)))
            return S_OK;
        if (o.guidFormatType == format.guidFormatType)
            *flags |= AUDIOMEDIATYPE_EQUAL_FORMAT_TYPES;
        if (o.guidFormatType == format.guidFormatType && o.dwSamplesPerFrame == format.dwSamplesPerFrame &&
            o.dwBytesPerSampleContainer == format.dwBytesPerSampleContainer &&
            o.dwValidBitsPerSample == format.dwValidBitsPerSample && o.fFramesPerSecond == format.fFramesPerSecond &&
            o.dwChannelMask == format.dwChannelMask)
            *flags |= AUDIOMEDIATYPE_EQUAL_FORMAT_DATA | AUDIOMEDIATYPE_EQUAL_FORMAT_USER_DATA;
        return S_OK;
    }

    const WAVEFORMATEX* __stdcall GetAudioFormat() override { return &wave.Format; }

    HRESULT __stdcall GetUncompressedAudioFormat(UNCOMPRESSEDAUDIOFORMAT* out) override
    {
        if (!out)
            return E_POINTER;
        *out = format;
        return S_OK;
    }

private:
    volatile LONG refCount = 1;
    UNCOMPRESSEDAUDIOFORMAT format;
    WAVEFORMATEXTENSIBLE wave;
};
} // namespace

STDAPI CreateAudioMediaTypeFromUncompressedAudioFormat(const UNCOMPRESSEDAUDIOFORMAT* format, IAudioMediaType** result)
{
    if (!format || !result)
        return E_POINTER;
    *result = new (std::nothrow) UncompressedMediaType(*format);
    return *result ? S_OK : E_OUTOFMEMORY;
}
