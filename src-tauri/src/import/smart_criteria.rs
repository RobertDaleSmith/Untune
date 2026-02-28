use std::collections::HashMap;
use std::path::PathBuf;

use serde::Serialize;

/// Serializable rule types that mirror the smart_playlists.rs Deserialize types.
/// We serialize these to JSON strings for storage in the DB.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SmartPlaylistRules {
    #[serde(rename = "match")]
    match_mode: String,
    rules: Vec<RuleEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<LimitConfig>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum RuleEntry {
    Group {
        #[serde(rename = "match")]
        match_mode: String,
        rules: Vec<RuleEntry>,
    },
    Condition {
        field: String,
        op: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<serde_json::Value>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LimitConfig {
    count: i64,
    sort_by: String,
    sort_dir: String,
}

/// Find Library.xml in standard macOS locations.
fn find_library_xml() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let candidates = [
        home.join("Music/Music/Library.xml"),
        home.join("Music/iTunes/iTunes Music Library.xml"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

/// Parse Library.xml, extract smart criteria for all smart playlists.
/// Returns a HashMap from playlist persistent_id to rules JSON string.
/// Non-fatal: returns empty map on any top-level error.
pub fn extract_smart_rules() -> Result<HashMap<String, String>, String> {
    let xml_path = match find_library_xml() {
        Some(p) => p,
        None => {
            log::info!("Library.xml not found — smart playlist rules will not be imported");
            return Ok(HashMap::new());
        }
    };

    log::info!("Found Library.xml at {}", xml_path.display());

    let file = std::fs::File::open(&xml_path)
        .map_err(|e| format!("Failed to open Library.xml: {}", e))?;
    let plist_value: plist::Value = plist::Value::from_reader(std::io::BufReader::new(file))
        .map_err(|e| format!("Failed to parse Library.xml plist: {}", e))?;

    let root = plist_value.as_dictionary()
        .ok_or("Library.xml root is not a dictionary")?;

    let playlists = root.get("Playlists")
        .and_then(|v| v.as_array())
        .ok_or("No Playlists array in Library.xml")?;

    let mut result = HashMap::new();

    for pl in playlists {
        let dict = match pl.as_dictionary() {
            Some(d) => d,
            None => continue,
        };

        // Must have Smart Criteria to be parseable
        let criteria_data = match dict.get("Smart Criteria").and_then(|v| v.as_data()) {
            Some(d) => d,
            None => continue,
        };

        let persistent_id = match dict.get("Playlist Persistent ID").and_then(|v| v.as_string()) {
            Some(s) => s.to_string(),
            None => continue,
        };

        let info_data = dict.get("Smart Info").and_then(|v| v.as_data());

        let parsed_criteria = match parse_criteria(criteria_data) {
            Some(c) => c,
            None => {
                log::debug!("Failed to parse Smart Criteria for playlist {}", persistent_id);
                continue;
            }
        };

        let limit = info_data.and_then(|d| parse_info(d));

        let rules = SmartPlaylistRules {
            match_mode: parsed_criteria.0,
            rules: parsed_criteria.1,
            limit,
        };

        match serde_json::to_string(&rules) {
            Ok(json) => {
                result.insert(persistent_id, json);
            }
            Err(e) => {
                log::debug!("Failed to serialize rules: {}", e);
            }
        }
    }

    log::info!("Extracted smart rules for {} playlists from Library.xml", result.len());
    Ok(result)
}

/// Read a big-endian u32 from data at offset.
fn read_u32_be(data: &[u8], offset: usize) -> Option<u32> {
    if offset + 4 > data.len() {
        return None;
    }
    Some(u32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ]))
}

/// Read a single byte from data at offset.
fn read_u8(data: &[u8], offset: usize) -> Option<u8> {
    data.get(offset).copied()
}

/// Parse the Smart Info binary blob into a LimitConfig.
fn parse_info(data: &[u8]) -> Option<LimitConfig> {
    if data.len() < 14 {
        return None;
    }

    let limit_bool = read_u8(data, 2)?;
    if limit_bool == 0 {
        return None; // No limit configured
    }

    let limit_method = read_u8(data, 3)?;
    // We only support item-count limits (method 0x03 = Items)
    if limit_method != 0x03 {
        return None;
    }

    let selection_method = read_u8(data, 7)?;
    let limit_int = read_u32_be(data, 8)?;
    let selection_sign = read_u8(data, 13).unwrap_or(0);

    let sort_by = match selection_method {
        0x02 => "random",
        0x05 => "title",
        0x06 => "album",
        0x07 => "artist",
        0x15 => "date_added",
        0x1a => "last_played_at",
        0x19 => "play_count",
        0x1c => "rating",
        _ => "random",
    };

    // selection_sign: 0 = ascending (lowest first), non-zero = descending
    let sort_dir = if selection_sign != 0 { "desc" } else { "asc" };

    Some(LimitConfig {
        count: limit_int as i64,
        sort_by: sort_by.to_string(),
        sort_dir: sort_dir.to_string(),
    })
}

/// Parse the Smart Criteria binary blob.
/// Returns (match_mode, Vec<RuleEntry>) or None on failure.
fn parse_criteria(data: &[u8]) -> Option<(String, Vec<RuleEntry>)> {
    if data.len() < 140 {
        return None;
    }

    // Offset 15: logic type — 0x00=AND, 0x01=OR
    let logic_type = read_u8(data, 15)?;
    let match_mode = if logic_type == 0x01 { "any" } else { "all" };

    // Rules start at offset 139
    let mut offset = 139;
    let mut rules = Vec::new();

    while offset + 128 <= data.len() {
        match parse_one_rule(data, &mut offset) {
            Some(entry) => rules.push(entry),
            None => {
                // Could not parse this rule; try to skip gracefully but stop
                break;
            }
        }
    }

    if rules.is_empty() {
        return None;
    }

    Some((match_mode.to_string(), rules))
}

/// Map a field ID byte to our field name. Returns None for unsupported fields.
fn field_id_to_name(id: u8) -> Option<&'static str> {
    match id {
        0x02 => Some("title"),
        0x04 => Some("artist"),
        0x47 => Some("album_artist"),
        0x03 => Some("album"),
        0x08 => Some("genre"),
        0x12 => Some("composer"),
        0x0e => Some("comments"),
        0x27 => Some("grouping"),
        0x07 => Some("year"),
        0x0b => Some("track_number"),
        0x18 => Some("disc_number"),
        0x0d => Some("duration"),
        0x0c => Some("size"),
        0x05 => Some("bit_rate"),
        0x06 => Some("sample_rate"),
        0x16 => Some("play_count"),
        0x44 => Some("skip_count"),
        0x19 => Some("rating"),
        0x9a => Some("loved"),
        0x10 => Some("date_added"),
        0x17 => Some("last_played_at"),
        0x45 => Some("last_skipped_at"),
        _ => None,
    }
}

/// Text fields that use string-based operators
const TEXT_FIELDS: &[&str] = &[
    "title", "artist", "album_artist", "album", "genre", "composer", "comments", "grouping",
];

/// Date fields
const DATE_FIELDS: &[&str] = &["date_added", "last_played_at", "last_skipped_at"];

/// Decode a UTF-16-like string from the binary blob at the given offset.
/// The format uses 2 bytes per character where only odd bytes carry data.
/// Returns (decoded_string, bytes_consumed including terminator).
fn decode_string(data: &[u8], start: usize) -> (String, usize) {
    let mut chars = Vec::new();
    let mut pos = start;

    while pos + 1 < data.len() {
        let ch = data[pos + 1]; // odd byte has the char
        if ch == 0x00 {
            // Check if both bytes are zero (null terminator)
            if data[pos] == 0x00 {
                pos += 2;
                break;
            }
        }
        chars.push(ch);
        pos += 2;
    }

    (String::from_utf8_lossy(&chars).to_string(), pos - start)
}

/// Parse a single rule at the current offset, advancing offset past it.
fn parse_one_rule(data: &[u8], offset: &mut usize) -> Option<RuleEntry> {
    let base = *offset;

    if base + 128 > data.len() {
        return None;
    }

    let field_id = read_u8(data, base)?;

    // Subexpression (nested group)
    if field_id == 0x00 {
        return parse_subexpression(data, offset);
    }

    let field_name = match field_id_to_name(field_id) {
        Some(name) => name,
        None => {
            // Unsupported field — skip this rule
            // Try to determine the advance amount
            skip_rule(data, offset);
            return None;
        }
    };

    let logic_sign = read_u8(data, base + 1)?;
    let logic_rule = read_u8(data, base + 4)?;

    // Boolean field (loved)
    if field_name == "loved" {
        let op = if logic_sign == 0x00 { "is_true" } else { "is_false" };
        skip_rule(data, offset);
        return Some(RuleEntry::Condition {
            field: field_name.to_string(),
            op: op.to_string(),
            value: None,
        });
    }

    // Text fields
    if TEXT_FIELDS.contains(&field_name) {
        let op = match (logic_rule, logic_sign) {
            (0x01, 0x01) => "is",
            (0x01, 0x03) => "is_not",
            (0x02, 0x01) => "contains",
            (0x02, 0x03) => "not_contains",
            (0x04, 0x01) => "starts_with",
            (0x08, 0x01) => "ends_with",
            _ => {
                skip_rule(data, offset);
                return None;
            }
        };

        // String data starts at base + 54
        let string_start = base + 54;
        if string_start >= data.len() {
            skip_rule(data, offset);
            return None;
        }

        let (value, str_bytes) = decode_string(data, string_start);

        // Advance offset: string_start + str_bytes + padding to next rule
        // The next rule starts at: termination_position + 2 bytes alignment
        // But the standard advance is: intA_offset + 67 = (base + 57) + 67 = base + 124
        // For string rules, we use the actual string end position
        let after_string = string_start + str_bytes;
        // Round up to next rule boundary
        *offset = after_string;

        return Some(RuleEntry::Condition {
            field: field_name.to_string(),
            op: op.to_string(),
            value: Some(serde_json::Value::String(value)),
        });
    }

    // Date fields
    if DATE_FIELDS.contains(&field_name) {
        let int_a_offset = base + 57;
        let time_value_offset = base + 65;
        let time_mult_offset = base + 73;

        let time_value = read_u32_be(data, time_value_offset).unwrap_or(0);
        let time_multiple = read_u32_be(data, time_mult_offset).unwrap_or(0);

        let entry = if time_multiple > 0 && time_value > 0 {
            // Relative date: time_value is seconds (inverted by sign), time_multiple gives unit
            let total_seconds = time_value as i64;
            let days = total_seconds / 86400;
            let days = if days == 0 { 1 } else { days };

            let op = match (logic_rule, logic_sign) {
                (_, 0x00) => "in_last",
                (_, 0x02) => "not_in_last",
                _ => "in_last",
            };

            RuleEntry::Condition {
                field: field_name.to_string(),
                op: op.to_string(),
                value: Some(serde_json::Value::Number(serde_json::Number::from(days))),
            }
        } else {
            // Absolute date from intA
            let int_a = read_u32_be(data, int_a_offset).unwrap_or(0);

            // iTunes dates are seconds since 2001-01-01 (Mac epoch)
            // Convert to ISO 8601 string
            let mac_epoch_unix = 978_307_200i64; // 2001-01-01 00:00:00 UTC in Unix time
            let unix_ts = mac_epoch_unix + int_a as i64;

            // Format as YYYY-MM-DD
            let date_str = timestamp_to_date_string(unix_ts);

            let op = match logic_sign {
                0x02 => "before",
                _ => "after",
            };

            RuleEntry::Condition {
                field: field_name.to_string(),
                op: op.to_string(),
                value: Some(serde_json::Value::String(date_str)),
            }
        };

        // Advance: intA_offset + 67
        *offset = int_a_offset + 67;
        return Some(entry);
    }

    // Numeric fields (including duration, rating, etc.)
    let int_a_offset = base + 57;
    let int_a = read_u32_be(data, int_a_offset).unwrap_or(0);
    let int_b_offset = base + 81;
    let int_b = read_u32_be(data, int_b_offset).unwrap_or(0);

    let (op, value) = match (logic_rule, logic_sign) {
        (0x01, 0x00) => ("eq", numeric_value(field_name, int_a)),
        (0x01, 0x02) => ("neq", numeric_value(field_name, int_a)),
        (0x10, 0x00) => ("gt", numeric_value(field_name, int_a)),
        (0x10, 0x02) => ("lte", numeric_value(field_name, int_a)),
        (0x40, 0x00) => ("lt", numeric_value(field_name, int_a)),
        (0x40, 0x02) => ("gte", numeric_value(field_name, int_a)),
        (0x00, 0x00) => {
            // Between: uses intA and intB
            let a = convert_numeric(field_name, int_a);
            let b = convert_numeric(field_name, int_b);
            ("between", serde_json::Value::Array(vec![
                json_number(a),
                json_number(b),
            ]))
        }
        _ => {
            *offset = int_a_offset + 67;
            return None;
        }
    };

    *offset = int_a_offset + 67;

    Some(RuleEntry::Condition {
        field: field_name.to_string(),
        op: op.to_string(),
        value: Some(value),
    })
}

/// Parse a subexpression (nested group) at the current offset.
fn parse_subexpression(data: &[u8], offset: &mut usize) -> Option<RuleEntry> {
    let base = *offset;

    if base + 192 > data.len() {
        return None;
    }

    let child_count_offset = base + 61;
    let child_count = read_u32_be(data, child_count_offset)? as usize;
    let sub_logic_offset = base + 68;
    let sub_logic = read_u8(data, sub_logic_offset)?;
    let sub_match = if sub_logic == 0x01 { "any" } else { "all" };

    // Children start 192 bytes from base
    *offset = base + 192;

    let mut children = Vec::new();
    for _ in 0..child_count {
        if *offset + 128 > data.len() {
            break;
        }
        match parse_one_rule(data, offset) {
            Some(entry) => children.push(entry),
            None => {
                // Rule was skipped (unsupported field) — continue to next
            }
        }
    }

    if children.is_empty() {
        return None;
    }

    Some(RuleEntry::Group {
        match_mode: sub_match.to_string(),
        rules: children,
    })
}

/// Skip a rule we can't parse, advancing offset appropriately.
/// For string rules this is tricky; for numeric rules it's base+57+67=base+124.
fn skip_rule(data: &[u8], offset: &mut usize) {
    let base = *offset;
    let field_id = data.get(base).copied().unwrap_or(0);

    // Check if this might be a string field by field_id
    let is_string_field = matches!(
        field_id,
        0x02 | 0x04 | 0x47 | 0x03 | 0x08 | 0x12 | 0x0e | 0x27
    );

    if is_string_field {
        // Scan for string termination from the string data start
        let string_start = base + 54;
        if string_start < data.len() {
            let (_, str_bytes) = decode_string(data, string_start);
            *offset = string_start + str_bytes;
            return;
        }
    }

    // Numeric/date/boolean: advance by standard amount
    *offset = base + 57 + 67; // intA_offset + 67
}

/// Convert a raw u32 value for a numeric field, applying field-specific conversions.
fn convert_numeric(field_name: &str, raw: u32) -> f64 {
    match field_name {
        "duration" => raw as f64 / 1000.0, // iTunes stores ms, we store seconds
        _ => raw as f64,
    }
}

/// Create a serde_json::Value::Number for a numeric field value.
fn numeric_value(field_name: &str, raw: u32) -> serde_json::Value {
    json_number(convert_numeric(field_name, raw))
}

/// Create a JSON number value, using integer form when possible.
fn json_number(v: f64) -> serde_json::Value {
    if v == (v as i64) as f64 {
        serde_json::Value::Number(serde_json::Number::from(v as i64))
    } else {
        serde_json::Number::from_f64(v)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Number(serde_json::Number::from(v as i64)))
    }
}

/// Convert a Unix timestamp to a YYYY-MM-DD date string.
fn timestamp_to_date_string(unix_ts: i64) -> String {
    // Simple date conversion without external crate
    // Days since Unix epoch
    let secs_per_day = 86400i64;
    let mut days = unix_ts / secs_per_day;

    // Calculate year, month, day from days since 1970-01-01
    let mut year = 1970i32;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }

    let leap = is_leap_year(year);
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];

    let mut month = 1u32;
    for &md in &month_days {
        if days < md {
            break;
        }
        days -= md;
        month += 1;
    }
    let day = days + 1;

    format!("{:04}-{:02}-{:02}", year, month, day)
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}
