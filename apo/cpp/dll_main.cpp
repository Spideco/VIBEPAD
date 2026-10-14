// Exportações COM da DLL: fábrica de classe e auto-registro (regsvr32 ou
// chamada direta de DllRegisterServer pelo instalador do VibePad).

#include "vibepad_apo.h"

#include <new>

static volatile LONG lockCount = 0;

class ClassFactory : public IClassFactory
{
public:
    HRESULT __stdcall QueryInterface(const IID& iid, void** ppv) override
    {
        if (!ppv)
            return E_POINTER;
        if (iid == __uuidof(IUnknown) || iid == __uuidof(IClassFactory))
        {
            *ppv = static_cast<IClassFactory*>(this);
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

    HRESULT __stdcall CreateInstance(IUnknown* outer, const IID& iid, void** ppv) override
    {
        if (!ppv)
            return E_POINTER;
        *ppv = nullptr;
        // Agregado: o objeto externo só pode pedir o IUnknown interno.
        if (outer && iid != __uuidof(IUnknown))
            return E_NOINTERFACE;

        VibePadApo* apo = new (std::nothrow) VibePadApo(outer);
        if (!apo)
            return E_OUTOFMEMORY;
        HRESULT hr = apo->NonDelegatingQueryInterface(iid, ppv);
        apo->NonDelegatingRelease();
        return hr;
    }

    HRESULT __stdcall LockServer(BOOL lock) override
    {
        if (lock)
            InterlockedIncrement(&lockCount);
        else
            InterlockedDecrement(&lockCount);
        return S_OK;
    }

private:
    volatile LONG refCount = 1;
};

extern "C" HRESULT __stdcall DllCanUnloadNow()
{
    return (VibePadApo::instanceCount == 0 && lockCount == 0) ? S_OK : S_FALSE;
}

extern "C" HRESULT __stdcall DllGetClassObject(const CLSID& clsid, const IID& iid, void** ppv)
{
    if (clsid != VIBEPAD_APO_CLSID)
        return CLASS_E_CLASSNOTAVAILABLE;
    ClassFactory* factory = new (std::nothrow) ClassFactory();
    if (!factory)
        return E_OUTOFMEMORY;
    HRESULT hr = factory->QueryInterface(iid, ppv);
    factory->Release();
    return hr;
}

static HRESULT setString(HKEY root, const wchar_t* path, const wchar_t* name, const wchar_t* value)
{
    LSTATUS status = RegSetKeyValueW(root, path, name, REG_SZ, value, (DWORD)((wcslen(value) + 1) * sizeof(wchar_t)));
    return HRESULT_FROM_WIN32(status);
}

extern "C" HRESULT __stdcall DllRegisterServer()
{
    // Sem DllMain próprio (a CRT estática já fornece um): descobre a DLL pelo endereço desta função.
    HMODULE moduleHandle = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCWSTR>(&DllRegisterServer), &moduleHandle);
    wchar_t dllPath[MAX_PATH];
    if (!GetModuleFileNameW(moduleHandle, dllPath, MAX_PATH))
        return HRESULT_FROM_WIN32(GetLastError());

    HRESULT hr = RegisterAPO(VibePadApo::regProperties);
    if (FAILED(hr))
        return hr;

    wchar_t clsid[64];
    StringFromGUID2(VIBEPAD_APO_CLSID, clsid, 64);
    wchar_t key[128];
    swprintf_s(key, L"SOFTWARE\\Classes\\CLSID\\%s", clsid);
    hr = setString(HKEY_LOCAL_MACHINE, key, nullptr, L"VibePad Mic APO");
    wcscat_s(key, L"\\InprocServer32");
    if (SUCCEEDED(hr))
        hr = setString(HKEY_LOCAL_MACHINE, key, nullptr, dllPath);
    if (SUCCEEDED(hr))
        hr = setString(HKEY_LOCAL_MACHINE, key, L"ThreadingModel", L"Both");
    if (FAILED(hr))
        UnregisterAPO(VIBEPAD_APO_CLSID);
    return hr;
}

extern "C" HRESULT __stdcall DllUnregisterServer()
{
    wchar_t clsid[64];
    StringFromGUID2(VIBEPAD_APO_CLSID, clsid, 64);
    wchar_t key[128];
    swprintf_s(key, L"SOFTWARE\\Classes\\CLSID\\%s", clsid);
    RegDeleteTreeW(HKEY_LOCAL_MACHINE, key);
    return UnregisterAPO(VIBEPAD_APO_CLSID);
}
