#![cfg(target_os = "macos")]
#![allow(unexpected_cfgs)]

use cocoa::appkit::{NSApp, NSMenu};
use cocoa::base::{id, nil, selector};
use cocoa::foundation::NSString;
use objc::runtime::{Class, Object, Sel};
use objc::{class, msg_send, sel, sel_impl};

use tauri::{AppHandle, Emitter};

use std::sync::OnceLock;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn setup_dock_menu(app: &AppHandle) {
    APP_HANDLE.set(app.clone()).ok();

    unsafe {
        register_dock_handler();

        let menu = NSMenu::new(nil);

        let play_pause = make_item("Play / Pause", "dockPlayPause:");
        let next = make_item("Next", "dockNext:");
        let prev = make_item("Previous", "dockPrevious:");

        menu.addItem_(play_pause);
        menu.addItem_(next);
        menu.addItem_(prev);

        let app_obj = NSApp();
        let _: () = msg_send![app_obj, setDockMenu: menu];
    }
}

unsafe fn make_item(title: &str, action: &str) -> id {
    let cls = class!(NSMenuItem);
    let title = NSString::alloc(nil).init_str(title);
    let action = selector(action);
    let key = NSString::alloc(nil).init_str("");
    let item: id = msg_send![cls, alloc];
    let item: id = msg_send![item, initWithTitle:title action:action keyEquivalent:key];

    let handler_cls = Class::get("UntuneDockHandler").unwrap();
    let handler: id = msg_send![handler_cls, shared];
    let _: () = msg_send![item, setTarget:handler];

    item
}

fn emit_event(event: &str) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit(event, ());
    }
}

unsafe fn register_dock_handler() {
    use objc::declare::ClassDecl;

    if Class::get("UntuneDockHandler").is_some() {
        return;
    }

    let superclass = Class::get("NSObject").unwrap();
    let mut decl = ClassDecl::new("UntuneDockHandler", superclass).unwrap();

    extern "C" fn shared_impl(cls: &Class, _sel: Sel) -> id {
        unsafe {
            static mut INSTANCE: *mut Object = std::ptr::null_mut();
            if INSTANCE.is_null() {
                let obj: id = msg_send![cls, alloc];
                let obj: id = msg_send![obj, init];
                INSTANCE = obj;
            }
            INSTANCE
        }
    }
    decl.add_class_method(
        sel!(shared),
        shared_impl as extern "C" fn(&Class, Sel) -> id,
    );

    extern "C" fn play_pause(_this: &Object, _sel: Sel, _sender: id) {
        emit_event("media-toggle");
    }
    extern "C" fn next(_this: &Object, _sel: Sel, _sender: id) {
        emit_event("media-next");
    }
    extern "C" fn previous(_this: &Object, _sel: Sel, _sender: id) {
        emit_event("media-prev");
    }

    decl.add_method(
        sel!(dockPlayPause:),
        play_pause as extern "C" fn(&Object, Sel, id),
    );
    decl.add_method(
        sel!(dockNext:),
        next as extern "C" fn(&Object, Sel, id),
    );
    decl.add_method(
        sel!(dockPrevious:),
        previous as extern "C" fn(&Object, Sel, id),
    );

    decl.register();
}
