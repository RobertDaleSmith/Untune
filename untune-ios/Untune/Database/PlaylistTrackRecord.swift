import GRDB

struct PlaylistTrackRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "playlistTracks"

    let playlistId: Int64
    let trackId: Int64
    let position: Int
}

struct PendingPlayStatRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "pendingPlayStats"

    var id: Int64?
    let trackId: Int64
    var playCountDelta: Int
    var skipCountDelta: Int
    var lastPlayedAt: String?
    var lastSkippedAt: String?

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
