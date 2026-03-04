use std::process::{Child, Command};

/// Advertises the sync server via Bonjour/mDNS as _untune._tcp
/// Uses the native macOS dns-sd command for reliable service registration
pub struct Discovery {
    child: Option<Child>,
}

impl Discovery {
    pub fn start(port: u16, desktop_name: &str) -> Self {
        // Use dns-sd to register the service via the native macOS Bonjour daemon
        let child = Command::new("dns-sd")
            .args([
                "-R",
                desktop_name,
                "_untune._tcp",
                "local",
                &port.to_string(),
                "path=/api",
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| log::error!("Failed to start Bonjour advertisement: {}", e))
            .ok();

        if child.is_some() {
            log::info!(
                "Bonjour: advertising '{}' as _untune._tcp on port {}",
                desktop_name,
                port
            );
        }

        Discovery { child }
    }

    pub fn stop(&mut self) {
        if let Some(ref mut child) = self.child {
            let _ = child.kill();
            let _ = child.wait();
            log::info!("Bonjour advertisement stopped");
        }
        self.child = None;
    }
}

impl Drop for Discovery {
    fn drop(&mut self) {
        self.stop();
    }
}
