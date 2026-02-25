use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn get_preference(key: String, db: State<Database>) -> Result<Option<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::get_preference(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_preference(key: String, value: String, db: State<Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::set_preference(&conn, &key, &value).map_err(|e| e.to_string())
}
