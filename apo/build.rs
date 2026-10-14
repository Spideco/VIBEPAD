fn main() {
    println!("cargo:rerun-if-changed=cpp");

    cc::Build::new()
        .cpp(true)
        .files(["cpp/vibepad_apo.cpp", "cpp/dll_main.cpp", "cpp/media_type.cpp"])
        .define("UNICODE", None)
        .define("_UNICODE", None)
        .flag("/std:c++17")
        .flag("/EHsc")
        .static_crt(true)
        .compile("vibepad_apo_cpp");

    // Classe base dos APOs + APIs usadas.
    for lib in ["AudioBaseProcessingObjectV140", "ole32", "advapi32", "propsys"] {
        println!("cargo:rustc-link-lib={lib}");
    }
    // As exportações COM vêm do C++; o /EXPORT também força o linker a incluí-las.
    for export in ["DllGetClassObject", "DllCanUnloadNow", "DllRegisterServer", "DllUnregisterServer"] {
        println!("cargo:rustc-cdylib-link-arg=/EXPORT:{export},PRIVATE");
    }
}
