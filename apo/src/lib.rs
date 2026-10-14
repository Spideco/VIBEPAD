//! Casca Rust da DLL do APO. A implementação está em `cpp/` e é compilada e
//! exportada pelo `build.rs`; este arquivo existe só para o Cargo gerar a DLL.
#![no_std]

#[cfg(not(test))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}
