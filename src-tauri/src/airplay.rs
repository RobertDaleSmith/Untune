#![cfg(target_os = "macos")]
#![allow(unexpected_cfgs)]

use cocoa::base::{id, nil};
use objc::{msg_send, sel, sel_impl};
use serde::Serialize;
use std::ffi::CStr;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioRoute {
    pub name: String,
    pub is_airplay: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: u32,
    pub name: String,
    pub is_airplay: bool,
    pub is_default: bool,
}

// --- Raw CoreAudio FFI ---

type OSStatus = i32;
type AudioObjectID = u32;

#[repr(C)]
struct AudioObjectPropertyAddress {
    m_selector: u32,
    m_scope: u32,
    m_element: u32,
}

const K_AUDIO_OBJECT_SYSTEM_OBJECT: AudioObjectID = 1;
const K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE: u32 = u32::from_be_bytes(*b"dOut");
const K_AUDIO_HARDWARE_PROPERTY_DEVICES: u32 = u32::from_be_bytes(*b"dev#");
const K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: u32 = u32::from_be_bytes(*b"glob");
const K_AUDIO_OBJECT_PROPERTY_SCOPE_OUTPUT: u32 = u32::from_be_bytes(*b"outp");
const K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: u32 = 0;
const K_AUDIO_DEVICE_PROPERTY_DEVICE_NAME_CF_STRING: u32 = u32::from_be_bytes(*b"lnam");
const K_AUDIO_DEVICE_PROPERTY_TRANSPORT_TYPE: u32 = u32::from_be_bytes(*b"tran");
const K_AUDIO_DEVICE_PROPERTY_STREAMS: u32 = u32::from_be_bytes(*b"stm#");
const K_AUDIO_DEVICE_TRANSPORT_TYPE_AIRPLAY: u32 = u32::from_be_bytes(*b"airp");

type AudioObjectPropertyListenerProc = unsafe extern "C" fn(
    AudioObjectID,
    u32,
    *const AudioObjectPropertyAddress,
    *mut std::ffi::c_void,
) -> OSStatus;

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyData(
        object_id: AudioObjectID,
        address: *const AudioObjectPropertyAddress,
        qualifier_data_size: u32,
        qualifier_data: *const std::ffi::c_void,
        data_size: *mut u32,
        data: *mut std::ffi::c_void,
    ) -> OSStatus;

    fn AudioObjectGetPropertyDataSize(
        object_id: AudioObjectID,
        address: *const AudioObjectPropertyAddress,
        qualifier_data_size: u32,
        qualifier_data: *const std::ffi::c_void,
        data_size: *mut u32,
    ) -> OSStatus;

    fn AudioObjectSetPropertyData(
        object_id: AudioObjectID,
        address: *const AudioObjectPropertyAddress,
        qualifier_data_size: u32,
        qualifier_data: *const std::ffi::c_void,
        data_size: u32,
        data: *const std::ffi::c_void,
    ) -> OSStatus;

    fn AudioObjectAddPropertyListener(
        object_id: AudioObjectID,
        address: *const AudioObjectPropertyAddress,
        listener: AudioObjectPropertyListenerProc,
        client_data: *mut std::ffi::c_void,
    ) -> OSStatus;
}

// --- Public API ---

/// Get the current default output device.
pub fn get_current_route() -> Result<AudioRoute, String> {
    unsafe {
        let device_id = get_default_output_device()?;
        let name = get_device_name(device_id)?;
        let is_airplay = get_device_transport_type(device_id)
            .map(|t| t == K_AUDIO_DEVICE_TRANSPORT_TYPE_AIRPLAY)
            .unwrap_or(false);
        Ok(AudioRoute { name, is_airplay })
    }
}

/// List all audio output devices.
pub fn get_output_devices() -> Result<Vec<AudioDevice>, String> {
    unsafe {
        let default_id = get_default_output_device()?;
        let all_ids = get_all_device_ids()?;
        let mut devices = Vec::new();

        for &dev_id in &all_ids {
            if !device_has_output_streams(dev_id) {
                continue;
            }
            let name = match get_device_name(dev_id) {
                Ok(n) => n,
                Err(_) => continue,
            };
            let is_airplay = get_device_transport_type(dev_id)
                .map(|t| t == K_AUDIO_DEVICE_TRANSPORT_TYPE_AIRPLAY)
                .unwrap_or(false);
            devices.push(AudioDevice {
                id: dev_id,
                name,
                is_airplay,
                is_default: dev_id == default_id,
            });
        }
        Ok(devices)
    }
}

/// Set the default output device by ID.
pub fn set_output_device(device_id: u32) -> Result<(), String> {
    unsafe {
        let address = AudioObjectPropertyAddress {
            m_selector: K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE,
            m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };
        let size = std::mem::size_of::<AudioObjectID>() as u32;
        let status = AudioObjectSetPropertyData(
            K_AUDIO_OBJECT_SYSTEM_OBJECT,
            &address,
            0,
            std::ptr::null(),
            size,
            &device_id as *const _ as *const std::ffi::c_void,
        );
        if status != 0 {
            return Err(format!("Failed to set output device: {}", status));
        }
        Ok(())
    }
}

/// Start monitoring for default output device changes.
pub fn start_device_monitor(app: &AppHandle) {
    APP_HANDLE.set(app.clone()).ok();

    unsafe {
        let address = AudioObjectPropertyAddress {
            m_selector: K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE,
            m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };
        let status = AudioObjectAddPropertyListener(
            K_AUDIO_OBJECT_SYSTEM_OBJECT,
            &address,
            device_change_callback,
            std::ptr::null_mut(),
        );
        if status != 0 {
            log::warn!("Failed to register audio device change listener: {}", status);
        }
    }
}

// --- Internal helpers ---

unsafe fn get_default_output_device() -> Result<AudioObjectID, String> {
    let mut device_id: AudioObjectID = 0;
    let mut size = std::mem::size_of::<AudioObjectID>() as u32;
    let address = AudioObjectPropertyAddress {
        m_selector: K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE,
        m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
        m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
    };
    let status = AudioObjectGetPropertyData(
        K_AUDIO_OBJECT_SYSTEM_OBJECT,
        &address,
        0,
        std::ptr::null(),
        &mut size,
        &mut device_id as *mut _ as *mut std::ffi::c_void,
    );
    if status != 0 {
        return Err(format!("Failed to get default output device: {}", status));
    }
    Ok(device_id)
}

unsafe fn get_all_device_ids() -> Result<Vec<AudioObjectID>, String> {
    let address = AudioObjectPropertyAddress {
        m_selector: K_AUDIO_HARDWARE_PROPERTY_DEVICES,
        m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
        m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
    };
    let mut size: u32 = 0;
    let status = AudioObjectGetPropertyDataSize(
        K_AUDIO_OBJECT_SYSTEM_OBJECT,
        &address,
        0,
        std::ptr::null(),
        &mut size,
    );
    if status != 0 {
        return Err(format!("Failed to get devices size: {}", status));
    }
    let count = size as usize / std::mem::size_of::<AudioObjectID>();
    let mut ids = vec![0u32; count];
    let status = AudioObjectGetPropertyData(
        K_AUDIO_OBJECT_SYSTEM_OBJECT,
        &address,
        0,
        std::ptr::null(),
        &mut size,
        ids.as_mut_ptr() as *mut std::ffi::c_void,
    );
    if status != 0 {
        return Err(format!("Failed to get device IDs: {}", status));
    }
    Ok(ids)
}

unsafe fn device_has_output_streams(device_id: AudioObjectID) -> bool {
    let address = AudioObjectPropertyAddress {
        m_selector: K_AUDIO_DEVICE_PROPERTY_STREAMS,
        m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_OUTPUT,
        m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
    };
    let mut size: u32 = 0;
    let status = AudioObjectGetPropertyDataSize(
        device_id,
        &address,
        0,
        std::ptr::null(),
        &mut size,
    );
    status == 0 && size > 0
}

unsafe fn get_device_name(device_id: AudioObjectID) -> Result<String, String> {
    let address = AudioObjectPropertyAddress {
        m_selector: K_AUDIO_DEVICE_PROPERTY_DEVICE_NAME_CF_STRING,
        m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
        m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
    };
    let mut cf_name: id = nil;
    let mut size = std::mem::size_of::<id>() as u32;
    let status = AudioObjectGetPropertyData(
        device_id,
        &address,
        0,
        std::ptr::null(),
        &mut size,
        &mut cf_name as *mut _ as *mut std::ffi::c_void,
    );
    if status != 0 || cf_name == nil {
        return Err(format!("Failed to get device name: {}", status));
    }
    let c_str_ptr: *const std::os::raw::c_char = msg_send![cf_name, UTF8String];
    if c_str_ptr.is_null() {
        return Err("Device name is null".into());
    }
    Ok(CStr::from_ptr(c_str_ptr).to_string_lossy().into_owned())
}

unsafe fn get_device_transport_type(device_id: AudioObjectID) -> Result<u32, String> {
    let address = AudioObjectPropertyAddress {
        m_selector: K_AUDIO_DEVICE_PROPERTY_TRANSPORT_TYPE,
        m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
        m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
    };
    let mut transport_type: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = AudioObjectGetPropertyData(
        device_id,
        &address,
        0,
        std::ptr::null(),
        &mut size,
        &mut transport_type as *mut _ as *mut std::ffi::c_void,
    );
    if status != 0 {
        return Err(format!("Failed to get transport type: {}", status));
    }
    Ok(transport_type)
}

unsafe extern "C" fn device_change_callback(
    _id: AudioObjectID,
    _num_addresses: u32,
    _addresses: *const AudioObjectPropertyAddress,
    _client_data: *mut std::ffi::c_void,
) -> OSStatus {
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(200));
        if let Some(app) = APP_HANDLE.get() {
            match get_current_route() {
                Ok(route) => {
                    let _ = app.emit("audio-route-changed", &route);
                }
                Err(e) => {
                    log::warn!("Failed to query audio route on change: {}", e);
                }
            }
        }
    });
    0
}
