// JXA script to bulk-extract playlists from Apple Music
// Run via: osascript extract_playlists.js
// Outputs temp file path to stdout

ObjC.import("Foundation");

const music = Application("Music");
const playlists = music.userPlaylists();

const data = [];
// Folders are not included in userPlaylists() on modern macOS.
// Discover them from children's parent() and inject into output.
const discoveredFolders = {};

for (let i = 0; i < playlists.length; i++) {
    const pl = playlists[i];
    try {
        // Skip built-in system playlists (Music/Library, Downloaded, etc.)
        // On modern macOS, regular playlists return "none"; older versions return 0/null/undefined
        try {
            const kind = pl.specialKind();
            if (kind && String(kind) !== "none") continue;
        } catch (e) { /* no specialKind property — regular playlist, keep it */ }

        const cls = String(pl.class());
        const isFolder = cls === "folderPlaylist";
        let parentPersistentId = null;
        try {
            const parent = pl.parent();
            if (parent && String(parent.class()) === "folderPlaylist") {
                parentPersistentId = parent.persistentID();
                // Collect folder info so we can add it to the output
                if (!discoveredFolders[parentPersistentId]) {
                    let folderParentPid = null;
                    try {
                        const gp = parent.parent();
                        if (gp && String(gp.class()) === "folderPlaylist") {
                            folderParentPid = gp.persistentID();
                        }
                    } catch (e) { /* top-level folder */ }
                    discoveredFolders[parentPersistentId] = {
                        persistentId: parentPersistentId,
                        name: parent.name(),
                        parentPersistentId: folderParentPid,
                    };
                }
            }
        } catch (e) { /* top-level playlist */ }

        data.push({
            persistentId: pl.persistentID(),
            name: pl.name(),
            isSmart: isFolder ? false : pl.smart(),
            isFolder: isFolder,
            parentPersistentId: parentPersistentId,
            trackPersistentIds: isFolder ? [] : pl.tracks.persistentID(),
        });
    } catch (e) {
        // Skip playlists that can't be read (e.g., Genius playlists)
    }
}

// Prepend discovered folders that aren't already in data (avoids duplicates)
const dataIds = new Set(data.map(d => d.persistentId));
const folderEntries = Object.values(discoveredFolders)
    .filter(f => !dataIds.has(f.persistentId))
    .map(f => ({
        persistentId: f.persistentId,
        name: f.name,
        isSmart: false,
        isFolder: true,
        parentPersistentId: f.parentPersistentId,
        trackPersistentIds: [],
    }));

const allData = folderEntries.concat(data);

const json = JSON.stringify(allData);
const tmpPath = `/tmp/waves_playlists_${Date.now()}.json`;
const nsString = $.NSString.alloc.initWithUTF8String(json);
nsString.writeToFileAtomicallyEncodingError(tmpPath, true, $.NSUTF8StringEncoding, null);

tmpPath;
