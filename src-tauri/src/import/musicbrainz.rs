use serde::Deserialize;

/// Metadata returned from a MusicBrainz lookup.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MbResult {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub track_count: Option<i32>,
    pub disc_number: Option<i32>,
    pub genre: Option<String>,
    pub release_type: Option<String>,
}

/// Search MusicBrainz for a recording by artist + title.
/// Returns the best match with full album details, or None if nothing found.
pub async fn lookup_track(artist: &str, title: &str) -> Option<MbResult> {
    let query = format!(
        "recording:\"{}\" AND artist:\"{}\"",
        escape_lucene(title),
        escape_lucene(artist),
    );

    let url = format!(
        "https://musicbrainz.org/ws/2/recording?query={}&fmt=json&limit=5",
        urlencoding(&query),
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "Untune/0.1.0 (https://github.com/untune)")
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        log::warn!("MusicBrainz search returned status {}", resp.status());
        return None;
    }

    let body: MbSearchResponse = resp.json().await.ok()?;
    let recordings = body.recordings?;

    // Find the best match: prefer recordings with a score >= 90
    // and that have at least one official album release
    let best = recordings
        .iter()
        .filter(|r| r.score.unwrap_or(0) >= 80)
        .find(|r| {
            r.releases.as_ref().map_or(false, |rels| {
                rels.iter().any(|rel| is_album_release(rel))
            })
        })
        .or_else(|| {
            // Fall back to any recording with score >= 80
            recordings.iter().find(|r| r.score.unwrap_or(0) >= 80)
        })?;

    // Extract the best release (prefer album over single/compilation)
    let release = best
        .releases
        .as_ref()
        .and_then(|rels| {
            rels.iter()
                .find(|r| is_album_release(r))
                .or_else(|| rels.first())
        });

    let mut result = MbResult {
        title: Some(best.title.clone()),
        artist: best
            .artist_credit
            .as_ref()
            .and_then(|ac| format_artist_credit(ac)),
        ..Default::default()
    };

    if let Some(rel) = release {
        result.album = Some(rel.title.clone());
        result.year = rel.date.as_ref().and_then(|d| parse_year(d));
        result.album_artist = rel
            .artist_credit
            .as_ref()
            .and_then(|ac| format_artist_credit(ac));

        // Extract track number and disc number from media
        if let Some(media) = &rel.media {
            for medium in media {
                if let Some(tracks) = &medium.track {
                    // Find our recording in this medium's track list
                    if let Some(track) = tracks.iter().find(|t| {
                        t.id == best.id
                            || t.title.as_deref() == Some(&best.title)
                    }) {
                        result.track_number = track.position.or_else(|| {
                            track.number.as_ref().and_then(|n| n.parse().ok())
                        });
                        result.disc_number = medium.position;
                        result.track_count = medium.track_count;
                        break;
                    }
                }
                // If no track list in response, use position from medium offset
                if result.track_number.is_none() {
                    result.track_count = medium.track_count;
                    result.disc_number = medium.position;
                }
            }
        }
    }

    // Extract genre from tags
    if let Some(tags) = &best.tags {
        // Pick the tag with the highest count
        result.genre = tags
            .iter()
            .max_by_key(|t| t.count.unwrap_or(0))
            .map(|t| capitalize_genre(&t.name));
    }

    Some(result)
}

/// Search MusicBrainz and return all distinct release options for a recording.
/// Each result represents a different album/release the track appears on.
pub async fn search_releases(artist: &str, title: &str) -> Vec<MbResult> {
    let query = format!(
        "recording:\"{}\" AND artist:\"{}\"",
        escape_lucene(title),
        escape_lucene(artist),
    );

    let url = format!(
        "https://musicbrainz.org/ws/2/recording?query={}&fmt=json&limit=10",
        urlencoding(&query),
    );

    let client = reqwest::Client::new();
    let resp = match client
        .get(&url)
        .header("User-Agent", "Untune/0.1.0 (https://github.com/untune)")
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    if !resp.status().is_success() {
        return Vec::new();
    }

    let body: MbSearchResponse = match resp.json().await {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };

    let recordings = match body.recordings {
        Some(r) => r,
        None => return Vec::new(),
    };

    let mut results: Vec<MbResult> = Vec::new();
    let mut seen_albums: std::collections::HashSet<String> = std::collections::HashSet::new();

    for recording in recordings.iter().filter(|r| r.score.unwrap_or(0) >= 70) {
        let rec_artist = recording
            .artist_credit
            .as_ref()
            .and_then(|ac| format_artist_credit(ac));

        let rec_genre = recording
            .tags
            .as_ref()
            .and_then(|tags| {
                tags.iter()
                    .max_by_key(|t| t.count.unwrap_or(0))
                    .map(|t| capitalize_genre(&t.name))
            });

        let releases = match &recording.releases {
            Some(r) => r,
            None => continue,
        };

        for release in releases {
            // Deduplicate by album title + artist
            let rel_artist = release
                .artist_credit
                .as_ref()
                .and_then(|ac| format_artist_credit(ac))
                .or_else(|| rec_artist.clone());
            let dedup_key = format!(
                "{}|{}",
                release.title.to_lowercase(),
                rel_artist.as_deref().unwrap_or("").to_lowercase(),
            );
            if seen_albums.contains(&dedup_key) {
                continue;
            }
            seen_albums.insert(dedup_key);

            let release_type = release
                .release_group
                .as_ref()
                .and_then(|rg| rg.primary_type.clone());

            let mut result = MbResult {
                title: Some(recording.title.clone()),
                artist: rec_artist.clone(),
                album: Some(release.title.clone()),
                album_artist: rel_artist,
                year: release.date.as_ref().and_then(|d| parse_year(d)),
                genre: rec_genre.clone(),
                release_type,
                ..Default::default()
            };

            // Extract track/disc info
            if let Some(media) = &release.media {
                for medium in media {
                    if let Some(tracks) = &medium.track {
                        if let Some(track) = tracks.iter().find(|t| {
                            t.id == recording.id
                                || t.title.as_deref() == Some(&recording.title)
                        }) {
                            result.track_number = track.position.or_else(|| {
                                track.number.as_ref().and_then(|n| n.parse().ok())
                            });
                            result.disc_number = medium.position;
                            result.track_count = medium.track_count;
                            break;
                        }
                    }
                    if result.track_number.is_none() {
                        result.track_count = medium.track_count;
                        result.disc_number = medium.position;
                    }
                }
            }

            results.push(result);
        }
    }

    // Sort: Albums first, then EPs, then singles, then by year
    results.sort_by(|a, b| {
        let type_order = |t: &Option<String>| match t.as_deref() {
            Some("Album") => 0,
            Some("EP") => 1,
            Some("Single") => 2,
            _ => 3,
        };
        type_order(&a.release_type)
            .cmp(&type_order(&b.release_type))
            .then_with(|| a.year.unwrap_or(9999).cmp(&b.year.unwrap_or(9999)))
    });

    results
}

/// Try to parse "Artist - Title" patterns common in YouTube video titles.
/// Returns (artist, title) if a pattern matches, or None.
pub fn parse_artist_title(video_title: &str) -> Option<(String, String)> {
    // Remove common YouTube suffixes
    let suffixes = [
        "(Official Video)",
        "(Official Music Video)",
        "(Official Audio)",
        "(Official Lyric Video)",
        "(Lyric Video)",
        "(Audio)",
        "(Visualizer)",
        "(Music Video)",
        "[Official Video]",
        "[Official Music Video]",
        "[Official Audio]",
        "[Audio]",
        "[Music Video]",
        "(Official HD Video)",
        "(HD)",
        "(HQ)",
    ];

    let mut title_str = video_title.trim().to_string();
    for suffix in &suffixes {
        if let Some(pos) = title_str.to_lowercase().rfind(&suffix.to_lowercase()) {
            title_str = title_str[..pos].trim().to_string();
        }
    }

    // Try "Artist - Title" split (most common pattern)
    // Use the first " - " or " – " or " — " as delimiter
    let delimiters = [" - ", " – ", " — ", " − "];
    for delim in &delimiters {
        if let Some(pos) = title_str.find(delim) {
            let artist = title_str[..pos].trim().to_string();
            let title = title_str[pos + delim.len()..].trim().to_string();
            if !artist.is_empty() && !title.is_empty() {
                return Some((artist, title));
            }
        }
    }

    None
}

// --- MusicBrainz response types ---

#[derive(Debug, Deserialize)]
struct MbSearchResponse {
    recordings: Option<Vec<MbRecording>>,
}

#[derive(Debug, Deserialize)]
struct MbRecording {
    id: String,
    title: String,
    score: Option<i32>,
    #[serde(rename = "artist-credit")]
    artist_credit: Option<Vec<MbArtistCredit>>,
    releases: Option<Vec<MbRelease>>,
    tags: Option<Vec<MbTag>>,
}

#[derive(Debug, Deserialize)]
struct MbArtistCredit {
    name: Option<String>,
    artist: Option<MbArtist>,
    joinphrase: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MbArtist {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MbRelease {
    title: String,
    date: Option<String>,
    #[serde(rename = "release-group")]
    release_group: Option<MbReleaseGroup>,
    #[serde(rename = "artist-credit")]
    artist_credit: Option<Vec<MbArtistCredit>>,
    media: Option<Vec<MbMedium>>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseGroup {
    #[serde(rename = "primary-type")]
    primary_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MbMedium {
    position: Option<i32>,
    #[serde(rename = "track-count")]
    track_count: Option<i32>,
    track: Option<Vec<MbTrack>>,
}

#[derive(Debug, Deserialize)]
struct MbTrack {
    id: String,
    number: Option<String>,
    title: Option<String>,
    position: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct MbTag {
    name: String,
    count: Option<i32>,
}

// --- Helpers ---

fn is_album_release(release: &MbRelease) -> bool {
    release
        .release_group
        .as_ref()
        .and_then(|rg| rg.primary_type.as_deref())
        .map(|t| t == "Album" || t == "EP")
        .unwrap_or(false)
}

fn format_artist_credit(credits: &[MbArtistCredit]) -> Option<String> {
    if credits.is_empty() {
        return None;
    }
    let mut result = String::new();
    for credit in credits {
        let name = credit
            .name
            .as_deref()
            .or_else(|| credit.artist.as_ref().and_then(|a| a.name.as_deref()))
            .unwrap_or("");
        result.push_str(name);
        if let Some(ref join) = credit.joinphrase {
            result.push_str(join);
        }
    }
    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

fn parse_year(date: &str) -> Option<i32> {
    // Dates come as "2020", "2020-01", or "2020-01-15"
    date.split('-').next()?.parse().ok()
}

fn capitalize_genre(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().to_string() + chars.as_str(),
    }
}

/// Minimal Lucene special character escaping for MusicBrainz queries.
fn escape_lucene(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' | '\\' | '+' | '-' | '!' | '(' | ')' | ':' | '^' | '[' | ']' | '{' | '}'
            | '~' | '*' | '?' | '/' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

/// Percent-encode a query string for use in a URL.
fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}
