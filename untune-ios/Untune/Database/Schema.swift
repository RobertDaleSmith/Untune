import GRDB

enum AppSchema {
    static func migrate(_ migrator: inout DatabaseMigrator) {
        migrator.registerMigration("v1") { db in
            try db.create(table: "tracks") { t in
                t.primaryKey("id", .integer)
                t.column("persistentId", .text).unique()
                t.column("title", .text).notNull()
                t.column("artist", .text)
                t.column("albumArtist", .text)
                t.column("album", .text)
                t.column("genre", .text)
                t.column("composer", .text)
                t.column("year", .integer)
                t.column("trackNumber", .integer)
                t.column("trackCount", .integer)
                t.column("discNumber", .integer)
                t.column("discCount", .integer)
                t.column("duration", .double)
                t.column("size", .integer)
                t.column("bitRate", .integer)
                t.column("sampleRate", .integer)
                t.column("playCount", .integer).defaults(to: 0)
                t.column("skipCount", .integer).defaults(to: 0)
                t.column("rating", .integer)
                t.column("loved", .boolean).defaults(to: false)
                t.column("dateAdded", .text)
                t.column("lastPlayedAt", .text)
                t.column("lastSkippedAt", .text)
                t.column("artworkHash", .text)
                t.column("hasArtwork", .boolean).defaults(to: false)
                t.column("mood", .text)
                t.column("energy", .integer)
                t.column("vibeTags", .text)
                t.column("bpm", .integer)
                t.column("danceability", .integer)
                t.column("acousticness", .integer)
                t.column("aiTaggedAt", .text)
                // iOS-specific
                t.column("localFilePath", .text)
                t.column("fileDownloaded", .boolean).defaults(to: false)
            }

            try db.create(table: "playlists") { t in
                t.primaryKey("id", .integer)
                t.column("persistentId", .text).unique().notNull()
                t.column("name", .text).notNull()
                t.column("isSmart", .boolean).defaults(to: false)
                t.column("isFolder", .boolean).defaults(to: false)
                t.column("parentId", .integer).references("playlists")
                t.column("sortOrder", .integer).defaults(to: 0)
                t.column("trackCount", .integer).defaults(to: 0)
            }

            try db.create(table: "playlistTracks") { t in
                t.column("playlistId", .integer).notNull()
                    .references("playlists", onDelete: .cascade)
                t.column("trackId", .integer).notNull()
                    .references("tracks", onDelete: .cascade)
                t.column("position", .integer).notNull()
                t.primaryKey(["playlistId", "trackId"])
            }

            try db.create(table: "pendingPlayStats") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("trackId", .integer).notNull()
                t.column("playCountDelta", .integer).defaults(to: 0)
                t.column("skipCountDelta", .integer).defaults(to: 0)
                t.column("lastPlayedAt", .text)
                t.column("lastSkippedAt", .text)
            }

            try db.create(table: "preferences") { t in
                t.primaryKey("key", .text)
                t.column("value", .text).notNull()
            }
        }
    }
}
