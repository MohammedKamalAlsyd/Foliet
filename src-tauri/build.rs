fn main() {
    if std::env::var("CARGO_CFG_TARGET_VENDOR").as_deref() == Ok("apple") {
        // Links Apple's compiler-rt (provides `___isPlatformVersionAtLeast` required by ort-sys CoreML)
        println!("cargo:rustc-link-arg=-fapple-link-rtlib");
    }

    tauri_build::build()
}
