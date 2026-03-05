import GRDB

struct PlaylistRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "playlists"

    let id: Int64
    let persistentId: String
    let name: String
    let isSmart: Bool
    let isFolder: Bool
    let parentId: Int64?
    let sortOrder: Int
    let trackCount: Int

    func toPlaylist() -> Playlist {
        Playlist(
            id: id,
            persistentId: persistentId,
            name: name,
            isSmart: isSmart,
            isFolder: isFolder,
            parentId: parentId,
            sortOrder: sortOrder,
            trackCount: trackCount
        )
    }

    static func from(_ playlist: Playlist) -> PlaylistRecord {
        PlaylistRecord(
            id: playlist.id,
            persistentId: playlist.persistentId,
            name: playlist.name,
            isSmart: playlist.isSmart,
            isFolder: playlist.isFolder,
            parentId: playlist.parentId,
            sortOrder: playlist.sortOrder,
            trackCount: playlist.trackCount
        )
    }
}
