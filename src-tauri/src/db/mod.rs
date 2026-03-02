mod schema;
mod queries;
mod insert;
pub mod similarity;

pub use queries::*;
pub use insert::*;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn init(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let app_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&app_dir)?;
        let db_path = app_dir.join("library.db");

        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA synchronous=NORMAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        schema::create_tables(&conn)?;

        log::info!("Database initialized at {:?}", db_path);

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    pub fn artwork_dir(app: &AppHandle) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
        let app_dir = app.path().app_data_dir()?;
        let artwork_dir = app_dir.join("artwork");
        std::fs::create_dir_all(&artwork_dir)?;
        Ok(artwork_dir)
    }
}
