fn main() {
    // Compile psflib (PSF container parser) — needs zlib for decompression
    cc::Build::new()
        .file("vendor/psflib/psflib.c")
        .file("vendor/psflib/psf2fs.c")
        .define("HAVE_STDINT_H", None)
        .warnings(false)
        .compile("psflib");
    println!("cargo:rustc-link-lib=z");

    // Compile Highly Experimental (PS1/PS2 PSF emulator core)
    cc::Build::new()
        .file("vendor/Highly_Experimental/Core/bios.c")
        .file("vendor/Highly_Experimental/Core/iop.c")
        .file("vendor/Highly_Experimental/Core/ioptimer.c")
        .file("vendor/Highly_Experimental/Core/mkhebios.c")
        .file("vendor/Highly_Experimental/Core/psx.c")
        .file("vendor/Highly_Experimental/Core/r3000.c")
        .file("vendor/Highly_Experimental/Core/spu.c")
        .file("vendor/Highly_Experimental/Core/spucore.c")
        .file("vendor/Highly_Experimental/Core/vfs.c")
        .define("EMU_COMPILE", None)
        .define("EMU_LITTLE_ENDIAN", None)
        .define("HAVE_STDINT_H", None)
        .include("vendor/Highly_Experimental/Core")
        .warnings(false)
        .compile("highly_experimental");

    tauri_build::build()
}
