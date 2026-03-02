#![cfg(target_os = "macos")]
#![allow(unexpected_cfgs)]

use cocoa::base::{id, nil, BOOL, YES};
use cocoa::foundation::NSString;
use objc::{class, msg_send, sel, sel_impl};
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

/// Wrapper around `id` so it can be stored in a static.
struct SendId(id);
unsafe impl Send for SendId {}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static SYNTHESIZER: OnceLock<Mutex<SendId>> = OnceLock::new();

fn synth_lock() -> &'static Mutex<SendId> {
    SYNTHESIZER.get_or_init(|| {
        unsafe {
            let cls = class!(NSSpeechSynthesizer);
            let synth: id = msg_send![cls, alloc];
            let synth: id = msg_send![synth, init];
            Mutex::new(SendId(synth))
        }
    })
}

struct SpeechSession {
    engine: id,
    request: id,
    task: id,
}

unsafe impl Send for SpeechSession {}

static SESSION: OnceLock<Mutex<Option<SpeechSession>>> = OnceLock::new();

fn session_lock() -> &'static Mutex<Option<SpeechSession>> {
    SESSION.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTranscript {
    pub text: String,
    pub is_final: bool,
}

#[link(name = "Speech", kind = "framework")]
extern "C" {}

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

pub fn init_speech(app: &AppHandle) {
    APP_HANDLE.set(app.clone()).ok();
}

/// Returns: "authorized", "denied", "restricted", "notDetermined"
pub fn check_speech_permission() -> String {
    unsafe {
        let cls = class!(SFSpeechRecognizer);
        let status: i64 = msg_send![cls, authorizationStatus];
        match status {
            0 => "notDetermined".into(),
            1 => "denied".into(),
            2 => "restricted".into(),
            3 => "authorized".into(),
            _ => "unknown".into(),
        }
    }
}

pub fn request_speech_permission() {
    unsafe {
        let cls = class!(SFSpeechRecognizer);
        let handler = block::ConcreteBlock::new(move |status: i64| {
            let perm = match status {
                3 => "authorized",
                _ => "denied",
            };
            if let Some(app) = APP_HANDLE.get() {
                let _ = app.emit("speech-permission-changed", perm);
            }
        });
        let handler = handler.copy();
        let _: () = msg_send![cls, requestAuthorization: &*handler];
    }
}

pub fn start_recognition() -> Result<(), String> {
    unsafe {
        // Check if already running
        {
            let guard = session_lock().lock().unwrap();
            if guard.is_some() {
                return Err("Already listening".into());
            }
        }

        // Create SFSpeechRecognizer
        let recognizer_cls = class!(SFSpeechRecognizer);
        let recognizer: id = msg_send![recognizer_cls, alloc];
        let recognizer: id = msg_send![recognizer, init];
        if recognizer == nil {
            return Err("Failed to create speech recognizer".into());
        }

        let available: BOOL = msg_send![recognizer, isAvailable];
        if available != YES {
            let _: () = msg_send![recognizer, release];
            return Err("Speech recognizer not available".into());
        }

        // Create SFSpeechAudioBufferRecognitionRequest
        let request_cls = class!(SFSpeechAudioBufferRecognitionRequest);
        let request: id = msg_send![request_cls, alloc];
        let request: id = msg_send![request, init];
        if request == nil {
            let _: () = msg_send![recognizer, release];
            return Err("Failed to create recognition request".into());
        }
        let _: () = msg_send![request, setShouldReportPartialResults: YES];

        // Create AVAudioEngine
        let engine_cls = class!(AVAudioEngine);
        let engine: id = msg_send![engine_cls, alloc];
        let engine: id = msg_send![engine, init];
        if engine == nil {
            let _: () = msg_send![request, release];
            let _: () = msg_send![recognizer, release];
            return Err("Failed to create audio engine".into());
        }

        // Get input node and format
        let input_node: id = msg_send![engine, inputNode];
        let format: id = msg_send![input_node, outputFormatForBus: 0u64];

        // Install tap on input node — captures audio and appends to recognition request
        let request_for_tap = request;
        let tap_block = block::ConcreteBlock::new(
            move |buffer: id, _when: id| {
                let _: () = msg_send![request_for_tap, appendAudioPCMBuffer: buffer];
            },
        );
        let tap_block = tap_block.copy();
        let _: () = msg_send![input_node, installTapOnBus: 0u64
                                          bufferSize: 1024u32
                                          format: format
                                          block: &*tap_block];

        // Start recognition task
        let request_for_handler = request;
        let result_handler = block::ConcreteBlock::new(
            move |result: id, error: id| {
                if result != nil {
                    let best: id = msg_send![result, bestTranscription];
                    let formatted: id = msg_send![best, formattedString];
                    let c_str: *const std::os::raw::c_char = msg_send![formatted, UTF8String];
                    let text = if c_str.is_null() {
                        String::new()
                    } else {
                        std::ffi::CStr::from_ptr(c_str).to_string_lossy().into_owned()
                    };

                    let is_final: BOOL = msg_send![result, isFinal];

                    if let Some(app) = APP_HANDLE.get() {
                        let _ = app.emit(
                            "speech-transcript",
                            SpeechTranscript {
                                text,
                                is_final: is_final == YES,
                            },
                        );
                    }

                    if is_final == YES {
                        // Auto-stop when we get a final result
                        let _ = stop_recognition_inner(request_for_handler);
                    }
                } else if error != nil {
                    // Extract error description
                    let desc: id = msg_send![error, localizedDescription];
                    let c_str: *const std::os::raw::c_char = msg_send![desc, UTF8String];
                    let error_msg = if c_str.is_null() {
                        "Unknown error".to_string()
                    } else {
                        std::ffi::CStr::from_ptr(c_str).to_string_lossy().into_owned()
                    };

                    if let Some(app) = APP_HANDLE.get() {
                        let _ = app.emit("speech-error", &error_msg);
                    }

                    let _ = stop_recognition_inner(request_for_handler);
                }
            },
        );
        let result_handler = result_handler.copy();
        let task: id = msg_send![recognizer, recognitionTaskWithRequest: request
                                             resultHandler: &*result_handler];

        // Prepare and start engine
        let _: () = msg_send![engine, prepare];
        let mut error: id = nil;
        let started: BOOL = msg_send![engine, startAndReturnError: &mut error];
        if started != YES {
            let _: () = msg_send![input_node, removeTapOnBus: 0u64];
            let _: () = msg_send![request, endAudio];
            let _: () = msg_send![task, cancel];
            let _: () = msg_send![engine, release];
            let _: () = msg_send![recognizer, release];
            return Err("Failed to start audio engine".into());
        }

        // Store session
        {
            let mut guard = session_lock().lock().unwrap();
            *guard = Some(SpeechSession {
                engine,
                request,
                task,
            });
        }

        // Release recognizer (task retains it)
        let _: () = msg_send![recognizer, release];

        Ok(())
    }
}

/// Internal stop that skips the request parameter (used from callbacks where request is captured)
unsafe fn stop_recognition_inner(_request_hint: id) -> Result<(), String> {
    let mut guard = session_lock().lock().unwrap();
    if let Some(session) = guard.take() {
        let input_node: id = msg_send![session.engine, inputNode];
        let _: () = msg_send![session.engine, stop];
        let _: () = msg_send![input_node, removeTapOnBus: 0u64];
        let _: () = msg_send![session.request, endAudio];
        let _: () = msg_send![session.task, cancel];
    }
    Ok(())
}

pub fn stop_recognition() -> Result<(), String> {
    unsafe {
        let mut guard = session_lock().lock().unwrap();
        if let Some(session) = guard.take() {
            let input_node: id = msg_send![session.engine, inputNode];
            let _: () = msg_send![session.engine, stop];
            let _: () = msg_send![input_node, removeTapOnBus: 0u64];
            let _: () = msg_send![session.request, endAudio];
            let _: () = msg_send![session.task, cancel];
        }
        Ok(())
    }
}

// --- TTS (Text-to-Speech) via NSSpeechSynthesizer ---

pub fn speak(text: &str) {
    unsafe {
        if let Ok(synth) = synth_lock().lock() {
            let ns_string: id = NSString::alloc(nil).init_str(text);
            let _: BOOL = msg_send![synth.0, startSpeakingString: ns_string];
        }
    }
}

pub fn stop_speak() -> Result<(), String> {
    unsafe {
        let synth = synth_lock().lock().map_err(|e| e.to_string())?;
        let _: () = msg_send![synth.0, stopSpeaking];
        Ok(())
    }
}

pub fn speaking() -> bool {
    unsafe {
        let synth = synth_lock().lock().unwrap();
        let is_speaking: BOOL = msg_send![synth.0, isSpeaking];
        is_speaking == YES
    }
}
