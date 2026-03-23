use std::ffi::{c_char, c_int, c_void};
use std::time::Duration;

use rodio::Source;

/// PSF file extensions (PS1, PS2)
pub const PSF_EXTENSIONS: &[&str] = &["psf", "minipsf", "psf2", "minipsf2"];

const PSF1_SAMPLE_RATE: u32 = 44100;
const PSF2_SAMPLE_RATE: u32 = 48000;
const DEFAULT_DURATION_SECS: f64 = 180.0;
const FADE_SECS: f64 = 10.0;

// --- FFI bindings for psflib ---

type PsfLoadCallback = unsafe extern "C" fn(
    context: *mut c_void,
    exe: *const u8,
    exe_size: usize,
    reserved: *const u8,
    reserved_size: usize,
) -> c_int;

type PsfInfoCallback = unsafe extern "C" fn(
    context: *mut c_void,
    name: *const c_char,
    value: *const c_char,
) -> c_int;

#[repr(C)]
struct PsfFileCallbacks {
    path_separators: *const c_char,
    context: *mut c_void,
    fopen: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    fread: unsafe extern "C" fn(*mut c_void, usize, usize, *mut c_void) -> usize,
    fseek: unsafe extern "C" fn(*mut c_void, i64, c_int) -> c_int,
    fclose: unsafe extern "C" fn(*mut c_void) -> c_int,
    ftell: unsafe extern "C" fn(*mut c_void) -> i64,
}

unsafe extern "C" {
    fn psf_load(
        uri: *const c_char,
        file_callbacks: *const PsfFileCallbacks,
        allowed_version: u8,
        load_target: PsfLoadCallback,
        load_context: *mut c_void,
        info_target: PsfInfoCallback,
        info_context: *mut c_void,
        info_want_nested_tags: c_int,
        status_target: *const c_void,
        status_context: *const c_void,
    ) -> c_int;

    fn psf2fs_create() -> *mut c_void;
    fn psf2fs_delete(psf2fs: *mut c_void);
    fn psf2fs_load_callback(
        psf2vfs: *mut c_void,
        exe: *const u8,
        exe_size: usize,
        reserved: *const u8,
        reserved_size: usize,
    ) -> c_int;
    fn psf2fs_virtual_readfile(
        psf2vfs: *mut c_void,
        path: *const c_char,
        offset: c_int,
        buffer: *mut c_char,
        length: c_int,
    ) -> c_int;
}

// --- FFI bindings for Highly Experimental ---

unsafe extern "C" {
    fn psx_init() -> i32;
    fn psx_get_state_size(version: u8) -> u32;
    fn psx_clear_state(state: *mut c_void, version: u8);
    fn psx_set_refresh(state: *mut c_void, refresh: u32);
    fn psx_execute(
        state: *mut c_void,
        cycles: i32,
        sound_buf: *mut i16,
        sound_samples: *mut u32,
        event_mask: u32,
    ) -> i32;

    fn psx_get_iop_state(state: *mut c_void) -> *mut c_void;

    fn psx_set_readfile(
        state: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *const c_char, i32, *mut c_char, i32) -> i32,
        context: *mut c_void,
    );

    fn bios_set_image(image: *const u8, size: u32);

    fn iop_upload_to_ram(state: *mut c_void, address: u32, src: *const c_void, len: u32);
    fn iop_get_r3000_state(state: *mut c_void) -> *mut c_void;
    fn iop_set_compat(state: *mut c_void, compat: u8);

    fn r3000_setreg(state: *mut c_void, regnum: i32, value: u32);
}

const R3000_REG_PC: i32 = 64;
const R3000_REG_GEN: i32 = 0;
const IOP_COMPAT_HARSH: u8 = 1;

// Embed the HEBIOS binary at compile time
static HEBIOS: &[u8] = include_bytes!("../vendor/Highly_Experimental/Core/hebios.bin");

static PSX_INIT: std::sync::Once = std::sync::Once::new();

fn ensure_psx_init() {
    PSX_INIT.call_once(|| unsafe {
        if !HEBIOS.is_empty() {
            bios_set_image(HEBIOS.as_ptr(), HEBIOS.len() as u32);
        }
        psx_init();
    });
}

// --- File I/O callbacks for psflib ---

unsafe extern "C" fn psf_fopen(context: *mut c_void, path: *const c_char) -> *mut c_void {
    let _ = context;
    let c_str = unsafe { std::ffi::CStr::from_ptr(path) };
    let path_str = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    match std::fs::File::open(path_str) {
        Ok(f) => Box::into_raw(Box::new(f)) as *mut c_void,
        Err(_) => std::ptr::null_mut(),
    }
}

unsafe extern "C" fn psf_fread(
    buffer: *mut c_void,
    size: usize,
    count: usize,
    handle: *mut c_void,
) -> usize {
    use std::io::Read;
    let file = unsafe { &mut *(handle as *mut std::fs::File) };
    let total = size * count;
    let slice = unsafe { std::slice::from_raw_parts_mut(buffer as *mut u8, total) };
    match file.read(slice) {
        Ok(n) => n / size,
        Err(_) => 0,
    }
}

unsafe extern "C" fn psf_fseek(handle: *mut c_void, offset: i64, whence: c_int) -> c_int {
    use std::io::Seek;
    let file = unsafe { &mut *(handle as *mut std::fs::File) };
    let pos = match whence {
        0 => std::io::SeekFrom::Start(offset as u64),
        1 => std::io::SeekFrom::Current(offset),
        2 => std::io::SeekFrom::End(offset),
        _ => return -1,
    };
    match file.seek(pos) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

unsafe extern "C" fn psf_fclose(handle: *mut c_void) -> c_int {
    let _ = unsafe { Box::from_raw(handle as *mut std::fs::File) };
    0
}

unsafe extern "C" fn psf_ftell(handle: *mut c_void) -> i64 {
    use std::io::Seek;
    let file = unsafe { &mut *(handle as *mut std::fs::File) };
    match file.stream_position() {
        Ok(n) => n as i64,
        Err(_) => -1,
    }
}

fn make_file_callbacks() -> PsfFileCallbacks {
    PsfFileCallbacks {
        path_separators: b"/\\\0".as_ptr() as *const c_char,
        context: std::ptr::null_mut(),
        fopen: psf_fopen,
        fread: psf_fread,
        fseek: psf_fseek,
        fclose: psf_fclose,
        ftell: psf_ftell,
    }
}

// --- PSF1 loader callback ---

struct Psf1LoadState {
    emu: *mut c_void,
    first: bool,
    refresh: u32,
}

unsafe extern "C" fn psf1_loader(
    context: *mut c_void,
    exe: *const u8,
    exe_size: usize,
    _reserved: *const u8,
    _reserved_size: usize,
) -> c_int {
    let state = unsafe { &mut *(context as *mut Psf1LoadState) };

    if exe_size < 0x800 {
        return -1;
    }

    let addr = unsafe { read_le32(exe.add(0x18)) } & 0x1fffff;
    let size = (exe_size - 0x800) as u32;

    if addr < 0x10000 || size > 0x1f0000 || addr + size > 0x200000 {
        return -1;
    }

    unsafe {
        let iop = psx_get_iop_state(state.emu);
        iop_upload_to_ram(iop, addr, exe.add(0x800) as *const c_void, size);

        if state.first {
            let r3000 = iop_get_r3000_state(iop);
            r3000_setreg(r3000, R3000_REG_PC, read_le32(exe.add(0x10)));
            r3000_setreg(r3000, R3000_REG_GEN + 29, read_le32(exe.add(0x30)));
            state.first = false;
        }

        // Detect region for refresh rate
        if state.refresh == 0 && exe_size > 113 + 13 {
            let region = std::slice::from_raw_parts(exe.add(113), 13);
            if region.starts_with(b"Japan") || region.starts_with(b"North America") {
                state.refresh = 60;
            } else if region.starts_with(b"Europe") {
                state.refresh = 50;
            }
        }
    }

    0
}

unsafe extern "C" fn psf_info_handler(
    context: *mut c_void,
    name: *const c_char,
    value: *const c_char,
) -> c_int {
    let state = unsafe { &mut *(context as *mut PsfTagState) };
    let name_str = unsafe { std::ffi::CStr::from_ptr(name) }.to_str().unwrap_or("");
    let value_str = unsafe { std::ffi::CStr::from_ptr(value) }.to_str().unwrap_or("");

    match name_str.to_lowercase().as_str() {
        "_refresh" => {
            if let Ok(r) = value_str.parse::<u32>() {
                state.refresh = r;
            }
        }
        "title" => state.title = Some(value_str.to_string()),
        "artist" => state.artist = Some(value_str.to_string()),
        "game" => state.game = Some(value_str.to_string()),
        "length" => state.length = parse_time_tag(value_str),
        "fade" => state.fade = parse_time_tag(value_str),
        _ => {}
    }
    0
}

struct PsfTagState {
    refresh: u32,
    title: Option<String>,
    artist: Option<String>,
    game: Option<String>,
    length: Option<f64>,
    fade: Option<f64>,
}

impl PsfTagState {
    fn new() -> Self {
        Self {
            refresh: 0,
            title: None,
            artist: None,
            game: None,
            length: None,
            fade: None,
        }
    }
}

/// Parse PSF time tags like "3:05.5" or "185.5"
fn parse_time_tag(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Some(colon_pos) = s.find(':') {
        let mins: f64 = s[..colon_pos].parse().ok()?;
        let secs: f64 = s[colon_pos + 1..].parse().ok()?;
        Some(mins * 60.0 + secs)
    } else {
        s.parse().ok()
    }
}

unsafe fn read_le32(ptr: *const u8) -> u32 {
    unsafe {
        (*ptr as u32)
            | ((*ptr.add(1) as u32) << 8)
            | ((*ptr.add(2) as u32) << 16)
            | ((*ptr.add(3) as u32) << 24)
    }
}

// --- PSF2 virtual filesystem readfile callback ---

unsafe extern "C" fn psf2_readfile(
    context: *mut c_void,
    path: *const c_char,
    offset: i32,
    buffer: *mut c_char,
    length: i32,
) -> i32 {
    unsafe { psf2fs_virtual_readfile(context, path, offset, buffer, length) }
}

// --- PsfSource ---

pub struct PsfSource {
    emu: *mut c_void,
    psf2fs: *mut c_void, // null for PSF1
    buffer: Vec<i16>,
    buffer_offset: usize,
    sample_rate: u32,
    total_duration: Duration,
    fade_duration: Duration,
    samples_rendered: u64,
    total_samples: u64,
    fade_start_sample: u64,
    /// Keep the file path for seek-by-reload
    path: String,
    version: u8,
}

// SAFETY: PsfSource is only used behind a Mutex or passed to a single rodio Sink thread.
unsafe impl Send for PsfSource {}

impl Drop for PsfSource {
    fn drop(&mut self) {
        if !self.emu.is_null() {
            // emu was allocated with libc::malloc via psx_get_state_size
            unsafe { libc_free(self.emu) };
        }
        if !self.psf2fs.is_null() {
            unsafe { psf2fs_delete(self.psf2fs) };
        }
    }
}

unsafe extern "C" {
    #[link_name = "free"]
    fn libc_free(ptr: *mut c_void);
    #[link_name = "malloc"]
    fn libc_malloc(size: usize) -> *mut c_void;
}

impl PsfSource {
    pub fn open(path: &str) -> Result<Self, String> {
        ensure_psx_init();

        let callbacks = make_file_callbacks();
        let c_path = std::ffi::CString::new(path).map_err(|e| e.to_string())?;

        // Probe version
        let version = unsafe {
            psf_load(
                c_path.as_ptr(),
                &callbacks,
                0,
                psf_null_loader,
                std::ptr::null_mut(),
                psf_null_info,
                std::ptr::null_mut(),
                0,
                std::ptr::null(),
                std::ptr::null(),
            )
        };

        if version != 1 && version != 2 {
            return Err(format!("Not a PSF1/PSF2 file (version {})", version));
        }

        // Parse tags
        let mut tags = PsfTagState::new();

        unsafe {
            psf_load(
                c_path.as_ptr(),
                &callbacks,
                version as u8,
                psf_null_loader,
                std::ptr::null_mut(),
                psf_info_handler,
                &mut tags as *mut PsfTagState as *mut c_void,
                0,
                std::ptr::null(),
                std::ptr::null(),
            );
        }

        let sample_rate = if version == 1 {
            PSF1_SAMPLE_RATE
        } else {
            PSF2_SAMPLE_RATE
        };

        let duration_secs = tags.length.unwrap_or(DEFAULT_DURATION_SECS);
        let fade_secs = tags.fade.unwrap_or(FADE_SECS);
        let total_secs = duration_secs + fade_secs;
        let total_duration = Duration::from_secs_f64(total_secs);
        let total_samples = (total_secs * sample_rate as f64) as u64;
        let fade_start_sample = (duration_secs * sample_rate as f64) as u64;

        // Allocate and initialize emulator state
        let state_size = unsafe { psx_get_state_size(version as u8) } as usize;
        let emu = unsafe { libc_malloc(state_size) };
        if emu.is_null() {
            return Err("Failed to allocate PSX state".to_string());
        }
        unsafe { psx_clear_state(emu, version as u8) };

        let mut psf2fs_ptr: *mut c_void = std::ptr::null_mut();

        if version == 1 {
            // PSF1: load exe into IOP RAM
            let mut load_state = Psf1LoadState {
                emu,
                first: true,
                refresh: tags.refresh,
            };

            let result = unsafe {
                psf_load(
                    c_path.as_ptr(),
                    &callbacks,
                    1,
                    psf1_loader,
                    &mut load_state as *mut Psf1LoadState as *mut c_void,
                    psf_null_info,
                    std::ptr::null_mut(),
                    1,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            };

            if result <= 0 {
                unsafe { libc_free(emu) };
                return Err("Failed to load PSF1 file".to_string());
            }

            if load_state.refresh > 0 {
                unsafe { psx_set_refresh(emu, load_state.refresh) };
            }
        } else {
            // PSF2: use virtual filesystem
            psf2fs_ptr = unsafe { psf2fs_create() };
            if psf2fs_ptr.is_null() {
                unsafe { libc_free(emu) };
                return Err("Failed to create PSF2 filesystem".to_string());
            }

            let result = unsafe {
                psf_load(
                    c_path.as_ptr(),
                    &callbacks,
                    2,
                    psf2fs_load_callback,
                    psf2fs_ptr,
                    psf_null_info,
                    std::ptr::null_mut(),
                    1,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            };

            if result <= 0 {
                unsafe {
                    psf2fs_delete(psf2fs_ptr);
                    libc_free(emu);
                }
                return Err("Failed to load PSF2 file".to_string());
            }

            if tags.refresh > 0 {
                unsafe { psx_set_refresh(emu, tags.refresh) };
            }

            unsafe { psx_set_readfile(emu, psf2_readfile, psf2fs_ptr) };
        }

        // Set compatibility mode
        unsafe {
            let iop = psx_get_iop_state(emu);
            iop_set_compat(iop, IOP_COMPAT_HARSH);
        }

        Ok(PsfSource {
            emu,
            psf2fs: psf2fs_ptr,
            buffer: Vec::new(),
            buffer_offset: 0,
            sample_rate,
            total_duration,
            fade_duration: Duration::from_secs_f64(fade_secs),
            samples_rendered: 0,
            total_samples,
            fade_start_sample,
            path: path.to_string(),
            version: version as u8,
        })
    }

    fn render_chunk(&mut self) -> bool {
        if self.samples_rendered >= self.total_samples {
            return false;
        }

        let mut count: u32 = 1024;
        let remaining = (self.total_samples - self.samples_rendered) as u32;
        if count > remaining {
            count = remaining;
        }

        self.buffer.resize(count as usize * 2, 0); // stereo

        let result = unsafe {
            psx_execute(
                self.emu,
                0x7FFFFFFF,
                self.buffer.as_mut_ptr(),
                &mut count,
                0,
            )
        };

        if result <= -2 || count == 0 {
            return false;
        }

        let actual_samples = count as usize * 2; // stereo
        self.buffer.truncate(actual_samples);

        // Apply fade-out
        let fade_total = self.total_samples - self.fade_start_sample;
        if fade_total > 0 && self.samples_rendered + count as u64 > self.fade_start_sample {
            for i in 0..actual_samples {
                let frame = self.samples_rendered + (i / 2) as u64;
                if frame >= self.fade_start_sample {
                    let fade_pos = frame - self.fade_start_sample;
                    let gain = 1.0 - (fade_pos as f64 / fade_total as f64);
                    self.buffer[i] = (self.buffer[i] as f64 * gain.max(0.0)) as i16;
                }
            }
        }

        self.samples_rendered += count as u64;
        self.buffer_offset = 0;
        true
    }
}

unsafe extern "C" fn psf_null_loader(
    _context: *mut c_void,
    _exe: *const u8,
    _exe_size: usize,
    _reserved: *const u8,
    _reserved_size: usize,
) -> c_int {
    0
}

unsafe extern "C" fn psf_null_info(
    _context: *mut c_void,
    _name: *const c_char,
    _value: *const c_char,
) -> c_int {
    0
}

impl Iterator for PsfSource {
    type Item = i16;

    fn next(&mut self) -> Option<i16> {
        if self.buffer_offset >= self.buffer.len() {
            if !self.render_chunk() {
                return None;
            }
        }
        let sample = self.buffer[self.buffer_offset];
        self.buffer_offset += 1;
        Some(sample)
    }
}

impl Source for PsfSource {
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.buffer.len().saturating_sub(self.buffer_offset))
    }

    fn channels(&self) -> u16 {
        2
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        Some(self.total_duration)
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        let target_secs = pos.as_secs_f64().min(self.total_duration.as_secs_f64());
        let target_frames = (target_secs * self.sample_rate as f64) as u64;

        if target_frames < self.samples_rendered {
            // Must reload from scratch
            let new = PsfSource::open(&self.path).map_err(|_| {
                rodio::source::SeekError::NotSupported {
                    underlying_source: "PSF reload failed during seek",
                }
            })?;
            // Swap internals
            if !self.emu.is_null() {
                unsafe { libc_free(self.emu) };
            }
            if !self.psf2fs.is_null() {
                unsafe { psf2fs_delete(self.psf2fs) };
            }
            self.emu = new.emu;
            self.psf2fs = new.psf2fs;
            self.samples_rendered = 0;
            self.buffer.clear();
            self.buffer_offset = 0;
            // Prevent double-free
            std::mem::forget(new);
        }

        // Fast-forward with null buffer
        while self.samples_rendered < target_frames {
            let mut count = (target_frames - self.samples_rendered).min(4096) as u32;
            let result = unsafe {
                psx_execute(self.emu, 0x7FFFFFFF, std::ptr::null_mut(), &mut count, 0)
            };
            if result <= -2 || count == 0 {
                break;
            }
            self.samples_rendered += count as u64;
        }

        self.buffer.clear();
        self.buffer_offset = 0;
        Ok(())
    }
}

/// Metadata from PSF tags
pub struct PsfMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub game: Option<String>,
    pub duration: Option<f64>,
}

/// Read metadata from PSF file tags
pub fn read_psf_metadata(path: &str) -> PsfMetadata {
    ensure_psx_init();

    let callbacks = make_file_callbacks();
    let c_path = match std::ffi::CString::new(path) {
        Ok(p) => p,
        Err(_) => {
            return PsfMetadata {
                title: None,
                artist: None,
                game: None,
                duration: Some(DEFAULT_DURATION_SECS),
            }
        }
    };

    let mut tags = PsfTagState::new();

    // Probe version first
    let version = unsafe {
        psf_load(
            c_path.as_ptr(),
            &callbacks,
            0,
            psf_null_loader,
            std::ptr::null_mut(),
            psf_null_info,
            std::ptr::null_mut(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    };

    if version > 0 {
        unsafe {
            psf_load(
                c_path.as_ptr(),
                &callbacks,
                version as u8,
                psf_null_loader,
                std::ptr::null_mut(),
                psf_info_handler,
                &mut tags as *mut PsfTagState as *mut c_void,
                0,
                std::ptr::null(),
                std::ptr::null(),
            );
        }
    }

    let duration = tags.length.or(Some(DEFAULT_DURATION_SECS));

    PsfMetadata {
        title: tags.title,
        artist: tags.artist,
        game: tags.game,
        duration,
    }
}
