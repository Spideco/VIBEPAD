//! Instalação do APO do VibePad no microfone (mesma técnica do Soundpad e do
//! Equalizer APO): copia a DLL para Arquivos de Programas, registra o COM e
//! aponta o slot de efeitos (FxProperties) do microfone para o nosso APO,
//! guardando o APO original para encadeá-lo e para restaurar na remoção.
//!
//! As funções que alteram o sistema rodam num processo elevado separado:
//! `vibepad.exe --mic-setup <install|uninstall> <guid> [dll] <arquivo-resultado>`.

use std::{
    ffi::OsStr,
    fs,
    os::windows::{ffi::OsStrExt, process::CommandExt},
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use windows::core::{w, PCWSTR, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, FreeLibrary, LocalFree, ERROR_SUCCESS, HANDLE, HLOCAL};
use windows::Win32::Media::Audio::{eCapture, eConsole, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE};
use windows::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, GRANT_ACCESS,
    SE_REGISTRY_KEY, TRUSTEE_IS_SID, TRUSTEE_IS_WELL_KNOWN_GROUP, TRUSTEE_W,
};
use windows::Win32::Security::{
    AdjustTokenPrivileges, CreateWellKnownSid, LookupPrivilegeValueW, WinBuiltinAdministratorsSid, ACL,
    DACL_SECURITY_INFORMATION, LUID_AND_ATTRIBUTES, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    SE_PRIVILEGE_ENABLED, SUB_CONTAINERS_AND_OBJECTS_INHERIT, TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::System::Registry::KEY_ALL_ACCESS;
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, WaitForSingleObject, INFINITE,
};
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
use winreg::{enums::*, RegKey};

pub const APO_CLSID: &str = "{ADE29FAA-683E-43F2-8906-D454CE2DCAD3}";
const DLL_NAME: &str = "vibepad_mic.dll";
const CAPTURE_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture";
/// Também lido pelo APO (`VIBEPAD_CHILD_KEY`) para achar o APO original.
const BACKUP_KEY: &str = r"SOFTWARE\VibePad\MicApo";

const LFX: &str = "{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},1";
const GFX: &str = "{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},2";
const SFX: &str = "{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},5";
const MFX: &str = "{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},6";
const EFX: &str = "{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},7";
const MULTI_SFX: &str = "{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},13";
const SFX_MODES: &str = "{d3993a3f-99c2-4402-b5ec-a92a0367664b},5";
const DEFAULT_MODE: &str = "{C18E2F7E-933D-4965-B7D1-1EEF228D2AF3}";
/// "Desativar aprimoramentos de áudio" — precisa estar desligado para o APO carregar.
const DISABLE_ENHANCEMENTS: &str = "{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5";

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

type SetupResult<T> = Result<T, String>;

// ---------------------------------------------------------------------------
// Consulta (roda no processo normal)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDevice {
    /// GUID do endpoint, ex.: "{3c2f...}" (a chave no registro).
    pub guid: String,
    pub name: String,
    pub is_default: bool,
    pub installed: bool,
}

fn endpoint_guid(id: &str) -> String {
    // IDs têm o formato "{0.0.1.00000000}.{guid}".
    id.rsplit('.').next().unwrap_or(id).to_string()
}

pub fn list_capture_devices() -> SetupResult<Vec<CaptureDevice>> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let default_id = enumerator
            .GetDefaultAudioEndpoint(eCapture, eConsole)
            .and_then(|d| d.GetId())
            .ok()
            .map(take_pwstr);
        let collection = enumerator
            .EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)
            .map_err(|e| e.to_string())?;
        let count = collection.GetCount().map_err(|e| e.to_string())?;

        let mut devices = Vec::new();
        for i in 0..count {
            let Ok(device) = collection.Item(i) else { continue };
            let Ok(id) = device.GetId().map(take_pwstr) else { continue };
            let name = device
                .OpenPropertyStore(STGM_READ)
                .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
                .and_then(|value| PropVariantToStringAlloc(&value))
                .map(take_pwstr)
                .unwrap_or_else(|_| "Microfone".into());
            let guid = endpoint_guid(&id);
            devices.push(CaptureDevice {
                installed: is_installed(&guid),
                is_default: default_id.as_deref() == Some(id.as_str()),
                guid,
                name,
            });
        }
        Ok(devices)
    }
}

/// Converte e libera uma string alocada pelo COM.
fn take_pwstr(p: PWSTR) -> String {
    unsafe {
        let s = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }
}

fn slot_has_apo(fx: &RegKey) -> bool {
    let single = [LFX, SFX]
        .iter()
        .any(|slot| fx.get_value::<String, _>(slot).is_ok_and(|v| v.eq_ignore_ascii_case(APO_CLSID)));
    let multi = fx
        .get_value::<Vec<String>, _>(MULTI_SFX)
        .is_ok_and(|list| list.iter().any(|v| v.eq_ignore_ascii_case(APO_CLSID)));
    single || multi
}

pub fn is_installed(guid: &str) -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey(format!(r"{CAPTURE_KEY}\{guid}\FxProperties"))
        .is_ok_and(|fx| slot_has_apo(&fx))
}

// ---------------------------------------------------------------------------
// Execução elevada
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct Outcome {
    ok: bool,
    message: String,
}

fn wide(s: impl AsRef<OsStr>) -> Vec<u16> {
    s.as_ref().encode_wide().chain(Some(0)).collect()
}

/// Reexecuta o próprio VibePad como administrador (pede o UAC) e espera o resultado.
pub fn run_elevated(action: &str, guid: &str, dll: Option<&Path>) -> SetupResult<String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let result_file = std::env::temp_dir().join(format!("vibepad-mic-{}.json", std::process::id()));
    let _ = fs::remove_file(&result_file);

    let mut params = format!("--mic-setup {action} {guid}");
    if let Some(dll) = dll {
        params.push_str(&format!(" \"{}\"", dll.display()));
    }
    params.push_str(&format!(" \"{}\"", result_file.display()));

    let file = wide(&exe);
    let parameters = wide(&params);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(parameters.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        ShellExecuteExW(&mut info)
            .map_err(|_| "A permissão de administrador foi negada.".to_string())?;
        let process: HANDLE = info.hProcess;
        WaitForSingleObject(process, INFINITE);
        let mut code = 1u32;
        let _ = GetExitCodeProcess(process, &mut code);
        let _ = CloseHandle(process);
    }

    let outcome: Outcome = fs::read_to_string(&result_file)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .ok_or("O instalador do microfone não retornou resultado.")?;
    let _ = fs::remove_file(&result_file);
    if outcome.ok {
        Ok(outcome.message)
    } else {
        Err(outcome.message)
    }
}

/// Ponto de entrada do processo elevado. Retorna `Some(código)` se os
/// argumentos eram do instalador (e o app não deve abrir a janela).
pub fn run_cli(args: &[String]) -> Option<i32> {
    if args.get(1).map(String::as_str) != Some("--mic-setup") {
        return None;
    }
    let action = args.get(2).cloned().unwrap_or_default();
    let guid = args.get(3).cloned().unwrap_or_default();
    let result_file = args.last().cloned().unwrap_or_default();

    let result = if !guid.starts_with('{') || !guid.ends_with('}') {
        Err("Dispositivo inválido.".to_string())
    } else if action == "install" && args.len() >= 6 {
        install(&guid, Path::new(&args[4]))
    } else if action == "uninstall" {
        uninstall(&guid)
    } else {
        Err("Comando de instalação inválido.".to_string())
    };

    let outcome = match &result {
        Ok(message) => Outcome { ok: true, message: message.clone() },
        Err(message) => Outcome { ok: false, message: message.clone() },
    };
    let _ = fs::write(&result_file, serde_json::to_string(&outcome).unwrap_or_default());
    Some(if result.is_ok() { 0 } else { 1 })
}

// ---------------------------------------------------------------------------
// Instalação / remoção (só no processo elevado)
// ---------------------------------------------------------------------------

fn install(guid: &str, dll_source: &Path) -> SetupResult<String> {
    let dll = install_dll(dll_source)?;
    register_com(&dll)?;
    configure_endpoint(guid)?;
    restart_audio_service()?;
    Ok("Microfone nativo instalado.".into())
}

fn uninstall(guid: &str) -> SetupResult<String> {
    restore_endpoint(guid)?;
    restart_audio_service()?;
    Ok("Microfone nativo removido.".into())
}

fn install_dir() -> PathBuf {
    let base = std::env::var_os("ProgramFiles").map(PathBuf::from).unwrap_or_else(|| r"C:\Program Files".into());
    base.join("VibePad").join("Mic")
}

/// A DLL precisa ficar num local que o serviço de áudio (LocalService) consiga
/// ler — a pasta do usuário não serve.
fn install_dll(source: &Path) -> SetupResult<PathBuf> {
    let source_bytes = fs::read(source).map_err(|e| format!("DLL do microfone não encontrada ({}): {e}", source.display()))?;
    let dir = install_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Não foi possível criar {}: {e}", dir.display()))?;
    let dest = dir.join(DLL_NAME);
    if fs::read(&dest).is_ok_and(|current| current == source_bytes) {
        return Ok(dest);
    }
    if fs::write(&dest, &source_bytes).is_err() {
        // Versão antiga em uso pelo audiodg: para o serviço, troca e o restart religa.
        stop_audio_service();
        fs::write(&dest, &source_bytes).map_err(|e| format!("Não foi possível copiar a DLL: {e}"))?;
    }
    Ok(dest)
}

fn register_com(dll: &Path) -> SetupResult<()> {
    unsafe {
        let path = wide(dll);
        let module = LoadLibraryW(PCWSTR(path.as_ptr())).map_err(|e| format!("Falha ao carregar a DLL: {e}"))?;
        let result = match GetProcAddress(module, windows::core::s!("DllRegisterServer")) {
            Some(proc) => {
                let register: extern "system" fn() -> windows::core::HRESULT = std::mem::transmute(proc);
                register().ok().map_err(|e| format!("Falha ao registrar o APO: {e}"))
            }
            None => Err("DLL do microfone inválida.".into()),
        };
        let _ = FreeLibrary(module);
        result
    }
}

fn configure_endpoint(guid: &str) -> SetupResult<()> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let device_path = format!(r"{CAPTURE_KEY}\{guid}");
    hklm.open_subkey(&device_path).map_err(|_| "Microfone não encontrado no registro.".to_string())?;

    let (fx, created) = open_fx_properties(&device_path)?;
    let (backup, _) = hklm
        .create_subkey(format!(r"{BACKUP_KEY}\{guid}"))
        .map_err(|e| format!("Falha ao criar o backup: {e}"))?;

    // Reinstalação: o backup já guarda o estado original, só reaplica.
    let first_install = backup.get_value::<String, _>("Slot").is_err();
    let has = |name: &str| fx.get_raw_value(name).is_ok();
    let set_err = |e: std::io::Error| format!("Falha ao gravar no registro: {e}");

    if first_install {
        if created {
            backup.set_value("KeyCreated", &1u32).map_err(set_err)?;
        }
        if let Ok(value) = fx.get_value::<u32, _>(DISABLE_ENHANCEMENTS) {
            backup.set_value("DisableEnhancements", &value).map_err(set_err)?;
        }
    }

    if has(MULTI_SFX) {
        // Drivers novos usam uma lista de SFX: entramos no fim dela.
        let mut list: Vec<String> = fx.get_value(MULTI_SFX).unwrap_or_default();
        if first_install {
            backup.set_value("Slot", &MULTI_SFX).map_err(set_err)?;
            backup.set_value("OriginalMulti", &list).map_err(set_err)?;
        }
        if !list.iter().any(|v| v.eq_ignore_ascii_case(APO_CLSID)) {
            list.push(APO_CLSID.to_string());
            fx.set_value(MULTI_SFX, &list).map_err(set_err)?;
        }
    } else {
        let legacy = (has(LFX) || has(GFX)) && !has(SFX) && !has(MFX) && !has(EFX);
        let slot = if legacy { LFX } else { SFX };
        if first_install {
            let original = fx.get_value::<String, _>(slot).unwrap_or_default();
            backup.set_value("Slot", &slot).map_err(set_err)?;
            backup.set_value("Original", &original).map_err(set_err)?;
            // O APO lê "Child" para encadear o efeito original do fabricante.
            if original.starts_with('{') && !original.eq_ignore_ascii_case(APO_CLSID) {
                backup.set_value("Child", &original).map_err(set_err)?;
            }
            if slot == SFX && !has(SFX_MODES) {
                backup.set_value("ModesAdded", &1u32).map_err(set_err)?;
            }
        }
        fx.set_value(slot, &APO_CLSID).map_err(set_err)?;
        if slot == SFX && !has(SFX_MODES) {
            fx.set_value(SFX_MODES, &vec![DEFAULT_MODE.to_string()]).map_err(set_err)?;
        }
    }

    if has(DISABLE_ENHANCEMENTS) {
        fx.delete_value(DISABLE_ENHANCEMENTS).map_err(set_err)?;
    }
    Ok(())
}

fn restore_endpoint(guid: &str) -> SetupResult<()> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let backup_path = format!(r"{BACKUP_KEY}\{guid}");
    let Ok(backup) = hklm.open_subkey(&backup_path) else {
        return Err("O VibePad não está instalado neste microfone.".into());
    };
    let device_path = format!(r"{CAPTURE_KEY}\{guid}");
    let set_err = |e: std::io::Error| format!("Falha ao restaurar o registro: {e}");

    if backup.get_value::<u32, _>("KeyCreated").is_ok() {
        grant_admin_access(&format!(r"MACHINE\{device_path}"))?;
        let _ = hklm.delete_subkey_all(format!(r"{device_path}\FxProperties"));
    } else if let Ok((fx, _)) = open_fx_properties(&device_path) {
        let slot: String = backup.get_value("Slot").unwrap_or_default();
        if slot == MULTI_SFX {
            let original: Vec<String> = backup.get_value("OriginalMulti").unwrap_or_default();
            fx.set_value(MULTI_SFX, &original).map_err(set_err)?;
        } else if !slot.is_empty() {
            let original: String = backup.get_value("Original").unwrap_or_default();
            if original.is_empty() {
                let _ = fx.delete_value(&slot);
            } else {
                fx.set_value(&slot, &original).map_err(set_err)?;
            }
            if backup.get_value::<u32, _>("ModesAdded").is_ok() {
                let _ = fx.delete_value(SFX_MODES);
            }
        }
        if let Ok(value) = backup.get_value::<u32, _>("DisableEnhancements") {
            fx.set_value(DISABLE_ENHANCEMENTS, &value).map_err(set_err)?;
        }
    }

    hklm.delete_subkey_all(&backup_path).map_err(set_err)?;
    Ok(())
}

/// Abre (ou cria) `FxProperties` para escrita. As chaves de endpoint pertencem
/// ao serviço de áudio; se o acesso for negado, o administrador assume a posse.
fn open_fx_properties(device_path: &str) -> SetupResult<(RegKey, bool)> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let fx_path = format!(r"{device_path}\FxProperties");

    if let Ok(fx) = hklm.open_subkey_with_flags(&fx_path, KEY_READ | KEY_WRITE) {
        return Ok((fx, false));
    }
    let exists = hklm.open_subkey(&fx_path).is_ok();
    if exists {
        grant_admin_access(&format!(r"MACHINE\{fx_path}"))?;
        let fx = hklm
            .open_subkey_with_flags(&fx_path, KEY_READ | KEY_WRITE)
            .map_err(|e| format!("Sem permissão para alterar o microfone: {e}"))?;
        return Ok((fx, false));
    }
    if let Ok((fx, _)) = hklm.create_subkey(&fx_path) {
        return Ok((fx, true));
    }
    grant_admin_access(&format!(r"MACHINE\{device_path}"))?;
    let (fx, _) = hklm
        .create_subkey(&fx_path)
        .map_err(|e| format!("Sem permissão para alterar o microfone: {e}"))?;
    Ok((fx, true))
}

fn enable_privilege(name: PCWSTR) -> SetupResult<()> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &mut token)
            .map_err(|e| e.to_string())?;
        let mut privileges = TOKEN_PRIVILEGES { PrivilegeCount: 1, ..Default::default() };
        let result = LookupPrivilegeValueW(PCWSTR::null(), name, &mut privileges.Privileges[0].Luid)
            .and_then(|_| {
                privileges.Privileges[0] = LUID_AND_ATTRIBUTES {
                    Luid: privileges.Privileges[0].Luid,
                    Attributes: SE_PRIVILEGE_ENABLED,
                };
                AdjustTokenPrivileges(token, false, Some(&privileges), 0, None, None)
            })
            .map_err(|e| e.to_string());
        let _ = CloseHandle(token);
        result
    }
}

/// Torna o grupo Administradores dono da chave e lhe dá controle total.
fn grant_admin_access(object: &str) -> SetupResult<()> {
    enable_privilege(w!("SeTakeOwnershipPrivilege"))?;
    enable_privilege(w!("SeRestorePrivilege"))?;
    let name = wide(object);
    let fail = |what: &str, code: u32| Err(format!("Falha ao ajustar permissões ({what}: {code})"));

    unsafe {
        let mut sid_buffer = [0u8; 68];
        let mut sid_size = sid_buffer.len() as u32;
        let sid = PSID(sid_buffer.as_mut_ptr() as *mut _);
        CreateWellKnownSid(WinBuiltinAdministratorsSid, None, Some(sid), &mut sid_size).map_err(|e| e.to_string())?;

        let status = SetNamedSecurityInfoW(PCWSTR(name.as_ptr()), SE_REGISTRY_KEY, OWNER_SECURITY_INFORMATION, Some(sid), None, None, None);
        if status != ERROR_SUCCESS {
            return fail("dono", status.0);
        }

        let mut old_dacl: *mut ACL = std::ptr::null_mut();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        let status = GetNamedSecurityInfoW(
            PCWSTR(name.as_ptr()),
            SE_REGISTRY_KEY,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(&mut old_dacl),
            None,
            &mut descriptor,
        );
        if status != ERROR_SUCCESS {
            return fail("leitura", status.0);
        }

        let access = EXPLICIT_ACCESS_W {
            grfAccessPermissions: KEY_ALL_ACCESS.0,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
            Trustee: TRUSTEE_W {
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_WELL_KNOWN_GROUP,
                ptstrName: PWSTR(sid.0 as *mut u16),
                ..Default::default()
            },
        };
        let mut new_dacl: *mut ACL = std::ptr::null_mut();
        let status = SetEntriesInAclW(Some(&[access]), Some(old_dacl), &mut new_dacl);
        let result = if status != ERROR_SUCCESS {
            fail("acl", status.0)
        } else {
            let status = SetNamedSecurityInfoW(PCWSTR(name.as_ptr()), SE_REGISTRY_KEY, DACL_SECURITY_INFORMATION, None, None, Some(new_dacl), None);
            if status != ERROR_SUCCESS { fail("gravação", status.0) } else { Ok(()) }
        };
        if !new_dacl.is_null() {
            let _ = LocalFree(Some(HLOCAL(new_dacl as *mut _)));
        }
        if !descriptor.0.is_null() {
            let _ = LocalFree(Some(HLOCAL(descriptor.0)));
        }
        result
    }
}

fn powershell(script: &str) -> std::io::Result<std::process::Output> {
    Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
}

fn stop_audio_service() {
    let _ = powershell("Stop-Service -Name Audiosrv -Force");
}

fn restart_audio_service() -> SetupResult<()> {
    let output = powershell("Restart-Service -Name Audiosrv -Force; Start-Service -Name Audiosrv")
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("A configuração foi aplicada, mas o serviço de áudio não reiniciou. Reinicie o computador.".into())
    }
}
