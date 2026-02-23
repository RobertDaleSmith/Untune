// JXA script to bulk-extract playlists from Apple Music
// Run via: osascript extract_playlists.js
// Outputs temp file path to stdout

ObjC.import("Foundation");

const music = Application("Music");
const playlists = music.userPlaylists();

const data = [];

for (let i = 0; i < playlists.length; i++) {
    const pl = playlists[i];
    try {
        const trackPersistentIds = pl.tracks.persistentID();
        data.push({
            persistentId: pl.persistentID(),
            name: pl.name(),
            isSmart: pl.smart(),
            trackPersistentIds: trackPersistentIds,
        });
    } catch (e) {
        // Skip playlists that can't be read (e.g., Genius playlists)
    }
}

const json = JSON.stringify(data);
const tmpPath = `/tmp/waves_playlists_${Date.now()}.json`;
const nsString = $.NSString.alloc.initWithUTF8String(json);
nsString.writeToFileAtomicallyEncodingError(tmpPath, true, $.NSUTF8StringEncoding, null);

tmpPath;
