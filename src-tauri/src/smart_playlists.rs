use rusqlite::types::ToSql;
use rusqlite::Connection;
use serde::Deserialize;

use crate::db::{map_track_row, TRACK_COLUMNS};
use crate::models::Track;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPlaylistRules {
    #[serde(rename = "match")]
    pub match_mode: String,
    pub rules: Vec<RuleEntry>,
    pub limit: Option<LimitConfig>,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum RuleEntry {
    Group {
        #[serde(rename = "match")]
        match_mode: String,
        rules: Vec<RuleEntry>,
    },
    Condition {
        field: String,
        op: String,
        value: Option<serde_json::Value>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitConfig {
    pub count: i64,
    pub sort_by: String,
    pub sort_dir: String,
}

const ALLOWED_FIELDS: &[&str] = &[
    "title",
    "artist",
    "album_artist",
    "album",
    "genre",
    "composer",
    "comments",
    "grouping",
    "mood",
    "vibe_tags",
    "year",
    "track_number",
    "disc_number",
    "duration",
    "size",
    "bit_rate",
    "sample_rate",
    "play_count",
    "skip_count",
    "rating",
    "energy",
    "bpm",
    "danceability",
    "acousticness",
    "loved",
    "date_added",
    "last_played_at",
    "last_skipped_at",
];

const TEXT_FIELDS: &[&str] = &[
    "title",
    "artist",
    "album_artist",
    "album",
    "genre",
    "composer",
    "comments",
    "grouping",
    "mood",
    "vibe_tags",
];

const NUMERIC_FIELDS: &[&str] = &[
    "year",
    "track_number",
    "disc_number",
    "duration",
    "size",
    "bit_rate",
    "sample_rate",
    "play_count",
    "skip_count",
    "rating",
    "energy",
    "bpm",
    "danceability",
    "acousticness",
];

const DATE_FIELDS: &[&str] = &["date_added", "last_played_at", "last_skipped_at"];

const ALLOWED_SORT_FIELDS: &[&str] = &[
    "random",
    "title",
    "artist",
    "album",
    "date_added",
    "last_played_at",
    "play_count",
    "rating",
    "duration",
    "energy",
    "bpm",
    "danceability",
];

/// Map frontend field names to actual DB column names
fn db_column(field: &str) -> &str {
    match field {
        "grouping" => "grouping_",
        other => other,
    }
}

fn build_where(
    entry: &RuleEntry,
    sql: &mut String,
    params: &mut Vec<Box<dyn ToSql>>,
) -> Result<(), String> {
    match entry {
        RuleEntry::Group { match_mode, rules } => {
            if rules.is_empty() {
                sql.push_str("1=1");
                return Ok(());
            }
            let joiner = if match_mode == "any" { " OR " } else { " AND " };
            sql.push('(');
            for (i, rule) in rules.iter().enumerate() {
                if i > 0 {
                    sql.push_str(joiner);
                }
                build_where(rule, sql, params)?;
            }
            sql.push(')');
            Ok(())
        }
        RuleEntry::Condition { field, op, value } => {
            if !ALLOWED_FIELDS.contains(&field.as_str()) {
                return Err(format!("Unknown field: {}", field));
            }
            let col = db_column(field);

            // Universal operators
            match op.as_str() {
                "is_set" => {
                    sql.push_str(&format!("({col} IS NOT NULL AND {col} != '')"));
                    return Ok(());
                }
                "is_not_set" => {
                    sql.push_str(&format!("({col} IS NULL OR {col} = '')"));
                    return Ok(());
                }
                _ => {}
            }

            // Boolean field
            if field == "loved" {
                match op.as_str() {
                    "is_true" => sql.push_str(&format!("{col} = 1")),
                    "is_false" => sql.push_str(&format!("({col} = 0 OR {col} IS NULL)")),
                    _ => return Err(format!("Invalid op '{}' for boolean field", op)),
                }
                return Ok(());
            }

            // Text operators
            if TEXT_FIELDS.contains(&field.as_str()) {
                let val_str = value
                    .as_ref()
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                match op.as_str() {
                    "is" => {
                        sql.push_str(&format!("COALESCE({col},'') = ?"));
                        params.push(Box::new(val_str));
                    }
                    "is_not" => {
                        sql.push_str(&format!("COALESCE({col},'') != ?"));
                        params.push(Box::new(val_str));
                    }
                    "contains" => {
                        sql.push_str(&format!("COALESCE({col},'') LIKE '%' || ? || '%'"));
                        params.push(Box::new(val_str));
                    }
                    "not_contains" => {
                        sql.push_str(&format!("COALESCE({col},'') NOT LIKE '%' || ? || '%'"));
                        params.push(Box::new(val_str));
                    }
                    "starts_with" => {
                        sql.push_str(&format!("COALESCE({col},'') LIKE ? || '%'"));
                        params.push(Box::new(val_str));
                    }
                    "ends_with" => {
                        sql.push_str(&format!("COALESCE({col},'') LIKE '%' || ?"));
                        params.push(Box::new(val_str));
                    }
                    _ => return Err(format!("Invalid op '{}' for text field", op)),
                }
                return Ok(());
            }

            // Numeric operators
            if NUMERIC_FIELDS.contains(&field.as_str()) {
                // Rating is stored as 0-100 (20 per star) but UI uses 1-5 stars
                let scale = |v: f64| -> f64 {
                    if field == "rating" { v * 20.0 } else { v }
                };

                match op.as_str() {
                    "eq" => {
                        let v = scale(value
                            .as_ref()
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0));
                        sql.push_str(&format!("COALESCE({col},0) = ?"));
                        params.push(Box::new(v));
                    }
                    "neq" => {
                        let v = scale(value
                            .as_ref()
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0));
                        sql.push_str(&format!("COALESCE({col},0) != ?"));
                        params.push(Box::new(v));
                    }
                    "gt" => {
                        let v = scale(value
                            .as_ref()
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0));
                        sql.push_str(&format!("COALESCE({col},0) > ?"));
                        params.push(Box::new(v));
                    }
                    "gte" => {
                        let v = scale(value
                            .as_ref()
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0));
                        sql.push_str(&format!("COALESCE({col},0) >= ?"));
                        params.push(Box::new(v));
                    }
                    "lt" => {
                        let v = scale(value
                            .as_ref()
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0));
                        sql.push_str(&format!("COALESCE({col},0) < ?"));
                        params.push(Box::new(v));
                    }
                    "lte" => {
                        let v = scale(value
                            .as_ref()
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0));
                        sql.push_str(&format!("COALESCE({col},0) <= ?"));
                        params.push(Box::new(v));
                    }
                    "between" => {
                        let arr = value
                            .as_ref()
                            .and_then(|v| v.as_array())
                            .ok_or("between requires [min, max] array")?;
                        let min = scale(arr.first().and_then(|v| v.as_f64()).unwrap_or(0.0));
                        let max = scale(arr.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0));
                        sql.push_str(&format!("COALESCE({col},0) BETWEEN ? AND ?"));
                        params.push(Box::new(min));
                        params.push(Box::new(max));
                    }
                    _ => return Err(format!("Invalid op '{}' for numeric field", op)),
                }
                return Ok(());
            }

            // Date operators
            if DATE_FIELDS.contains(&field.as_str()) {
                match op.as_str() {
                    "in_last" => {
                        let days = value
                            .as_ref()
                            .and_then(|v| v.as_i64())
                            .unwrap_or(30);
                        sql.push_str(&format!(
                            "{col} >= datetime('now', '-' || ? || ' days')"
                        ));
                        params.push(Box::new(days));
                    }
                    "not_in_last" => {
                        let days = value
                            .as_ref()
                            .and_then(|v| v.as_i64())
                            .unwrap_or(30);
                        sql.push_str(&format!(
                            "({col} IS NULL OR {col} < datetime('now', '-' || ? || ' days'))"
                        ));
                        params.push(Box::new(days));
                    }
                    "before" => {
                        let date = value
                            .as_ref()
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        sql.push_str(&format!("{col} < ?"));
                        params.push(Box::new(date));
                    }
                    "after" => {
                        let date = value
                            .as_ref()
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        sql.push_str(&format!("{col} > ?"));
                        params.push(Box::new(date));
                    }
                    _ => return Err(format!("Invalid op '{}' for date field", op)),
                }
                return Ok(());
            }

            Err(format!("Field '{}' has no valid category", field))
        }
    }
}

pub fn evaluate(conn: &Connection, rules_json: &str) -> Result<Vec<Track>, String> {
    let rules: SmartPlaylistRules =
        serde_json::from_str(rules_json).map_err(|e| format!("Invalid rules JSON: {}", e))?;

    let mut where_clause = String::new();
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();

    // Build the root group
    let root = RuleEntry::Group {
        match_mode: rules.match_mode,
        rules: rules.rules,
    };
    build_where(&root, &mut where_clause, &mut params)?;

    if where_clause.is_empty() {
        where_clause = "1=1".to_string();
    }

    // Build ORDER BY + LIMIT from limit config
    let order_limit = if let Some(ref limit) = rules.limit {
        let sort_col = if ALLOWED_SORT_FIELDS.contains(&limit.sort_by.as_str()) {
            if limit.sort_by == "random" {
                "RANDOM()".to_string()
            } else {
                db_column(&limit.sort_by).to_string()
            }
        } else {
            "id".to_string()
        };
        let dir = if limit.sort_dir == "desc" {
            "DESC"
        } else {
            "ASC"
        };
        if sort_col == "RANDOM()" {
            format!(" ORDER BY RANDOM() LIMIT {}", limit.count)
        } else {
            format!(" ORDER BY {} {} LIMIT {}", sort_col, dir, limit.count)
        }
    } else {
        String::new()
    };

    let sql = format!(
        "SELECT {} FROM tracks WHERE {}{}",
        TRACK_COLUMNS, where_clause, order_limit
    );

    let param_refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let conn_result = conn
        .prepare(&sql)
        .map_err(|e| format!("SQL prepare error: {}", e))?;
    let mut stmt = conn_result;

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| map_track_row(row))
        .map_err(|e| format!("SQL query error: {}", e))?;

    let mut tracks = Vec::new();
    for row in rows {
        tracks.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(tracks)
}
