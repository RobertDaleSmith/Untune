// JXA script to bulk-extract all track metadata from Apple Music
// Run via: osascript extract_tracks.js
// Outputs temp file path to stdout

ObjC.import("Foundation");

const music = Application("Music");
const tracks = music.tracks; // ObjectSpecifier — NOT tracks() which evaluates to a plain array

const data = {
    persistentId: tracks.persistentID(),
    name: tracks.name(),
    artist: tracks.artist(),
    albumArtist: tracks.albumArtist(),
    album: tracks.album(),
    genre: tracks.genre(),
    composer: tracks.composer(),
    year: tracks.year(),
    trackNumber: tracks.trackNumber(),
    trackCount: tracks.trackCount(),
    discNumber: tracks.discNumber(),
    discCount: tracks.discCount(),
    duration: tracks.duration(),
    size: tracks.size(),
    bitRate: tracks.bitRate(),
    sampleRate: tracks.sampleRate(),
    playCount: tracks.playedCount(),
    skipCount: tracks.skippedCount(),
    rating: tracks.rating(),
    loved: tracks.favorited(),
    dateAdded: tracks.dateAdded().map(d => d ? d.toISOString() : null),
    lastPlayedAt: tracks.playedDate().map(d => d ? d.toISOString() : null),
    lastSkippedAt: tracks.skippedDate().map(d => d ? d.toISOString() : null),
    comments: tracks.comment(),
    grouping: tracks.grouping(),
    sortName: tracks.sortName(),
    sortArtist: tracks.sortArtist(),
    sortAlbum: tracks.sortAlbum(),
    sortAlbumArtist: tracks.sortAlbumArtist(),
    sortComposer: tracks.sortComposer(),
};

const json = JSON.stringify(data);
const tmpPath = `/tmp/waves_tracks_${Date.now()}.json`;
const nsString = $.NSString.alloc.initWithUTF8String(json);
nsString.writeToFileAtomicallyEncodingError(tmpPath, true, $.NSUTF8StringEncoding, null);

tmpPath;
