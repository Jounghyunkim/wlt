fn main() {
    tauri_build::build();

    // tauri-build links the Windows resource (with the common-controls v6
    // manifest Tauri needs) into binaries only. Test executables without it die
    // at startup with STATUS_ENTRYPOINT_NOT_FOUND, so link it into them too.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
        for name in ["libresource.a", "resource.lib"] {
            let res = out_dir.join(name);
            if res.exists() {
                println!("cargo:rustc-link-arg={}", res.display());
            }
        }
    }
}
