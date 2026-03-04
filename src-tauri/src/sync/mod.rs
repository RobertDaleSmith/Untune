pub mod discovery;
pub mod models;
pub mod server;

use discovery::Discovery;
use server::{build_router, SyncServerState};
use std::sync::{Arc, Mutex};

const SYNC_PORT: u16 = 8485;

pub struct SyncServer {
    discovery: Option<Discovery>,
    runtime: Option<tokio::runtime::Runtime>,
    server_handle: Option<tokio::task::JoinHandle<()>>,
    pub pairing_code: Arc<Mutex<Option<String>>>,
    pub is_running: Arc<std::sync::atomic::AtomicBool>,
}

impl SyncServer {
    pub fn new() -> Self {
        SyncServer {
            discovery: None,
            runtime: None,
            server_handle: None,
            pairing_code: Arc::new(Mutex::new(None)),
            is_running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn start(&mut self, db_path: String, artwork_dir: String, desktop_name: String) {
        if self.is_running.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }

        let state = SyncServerState {
            db_path,
            artwork_dir,
            pairing_code: self.pairing_code.clone(),
            desktop_name: desktop_name.clone(),
        };

        let router = build_router(state);

        // Create a dedicated runtime for the sync server
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("Failed to create sync server runtime");

        let handle = rt.spawn(async move {
            // Bind to all interfaces (IPv4 and IPv6)
            let listener = match tokio::net::TcpListener::bind(format!("[::]:{}", SYNC_PORT)).await {
                Ok(l) => l,
                Err(e) => {
                    log::error!("Failed to bind sync server on port {}: {}", SYNC_PORT, e);
                    return;
                }
            };
            log::info!("Sync server listening on port {}", SYNC_PORT);
            axum::serve(listener, router).await.ok();
        });

        self.server_handle = Some(handle);
        self.runtime = Some(rt);
        self.discovery = Some(Discovery::start(SYNC_PORT, &desktop_name));
        self.is_running
            .store(true, std::sync::atomic::Ordering::Relaxed);

        log::info!("Sync server started with Bonjour advertising");
    }

    pub fn stop(&mut self) {
        if let Some(ref mut discovery) = self.discovery {
            discovery.stop();
        }
        if let Some(handle) = self.server_handle.take() {
            handle.abort();
        }
        // Drop the runtime to clean up all tasks
        self.runtime = None;
        self.discovery = None;
        self.is_running
            .store(false, std::sync::atomic::Ordering::Relaxed);
        log::info!("Sync server stopped");
    }

    pub fn generate_pairing_code(&self) -> String {
        let code: u32 = rand::random::<u32>() % 10000;
        let code_str = format!("{:04}", code);
        *self.pairing_code.lock().unwrap() = Some(code_str.clone());
        code_str
    }
}

impl Default for SyncServer {
    fn default() -> Self {
        Self::new()
    }
}
