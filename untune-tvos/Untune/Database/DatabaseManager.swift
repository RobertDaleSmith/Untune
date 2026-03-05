import Foundation
import GRDB

@Observable
class DatabaseManager {
    static let shared = DatabaseManager()

    private let dbPool: DatabasePool

    private init() {
        do {
            let fileManager = FileManager.default
            let caches = try fileManager.url(
                for: .cachesDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            let dbURL = caches.appendingPathComponent("library.db")

            var config = Configuration()
            config.prepareDatabase { db in
                db.trace { print("SQL: \($0)") }
            }

            dbPool = try DatabasePool(path: dbURL.path, configuration: config)

            var migrator = DatabaseMigrator()
            AppSchema.migrate(&migrator)
            try migrator.migrate(dbPool)
        } catch {
            fatalError("Database setup failed: \(error)")
        }
    }

    // MARK: - Tracks

    func fetchAllTracks() throws -> [Track] {
        try dbPool.read { db in
            try TrackRecord.fetchAll(db).map { $0.toTrack() }
        }
    }

    func fetchTracks(forPlaylist playlistId: Int64) throws -> [Track] {
        try dbPool.read { db in
            let sql = """
                SELECT t.* FROM tracks t
                JOIN playlistTracks pt ON pt.trackId = t.id
                WHERE pt.playlistId = ?
                ORDER BY pt.position
                """
            return try TrackRecord.fetchAll(db, sql: sql, arguments: [playlistId])
                .map { $0.toTrack() }
        }
    }

    func insertTrack(_ track: Track) throws {
        try dbPool.write { db in
            try TrackRecord.from(track).insert(db)
        }
    }

    func insertTracks(_ tracks: [Track]) throws {
        try dbPool.write { db in
            for track in tracks {
                try TrackRecord.from(track).insert(db)
            }
        }
    }

    // MARK: - Playlists

    func fetchAllPlaylists() throws -> [Playlist] {
        try dbPool.read { db in
            try PlaylistRecord
                .order(Column("sortOrder"))
                .fetchAll(db)
                .map { $0.toPlaylist() }
        }
    }

    func insertPlaylist(_ playlist: Playlist) throws {
        try dbPool.write { db in
            try PlaylistRecord.from(playlist).insert(db)
        }
    }

    func insertPlaylistTracks(_ playlistId: Int64, trackIds: [Int64]) throws {
        try dbPool.write { db in
            for (index, trackId) in trackIds.enumerated() {
                let record = PlaylistTrackRecord(
                    playlistId: playlistId,
                    trackId: trackId,
                    position: index
                )
                try record.insert(db)
            }
        }
    }

    // MARK: - Play Stats

    func recordPlay(trackId: Int64) throws {
        try dbPool.write { db in
            try db.execute(
                sql: "UPDATE tracks SET playCount = playCount + 1, lastPlayedAt = ? WHERE id = ?",
                arguments: [ISO8601DateFormatter().string(from: Date()), trackId]
            )
            let stat = PendingPlayStatRecord(
                trackId: trackId,
                playCountDelta: 1,
                skipCountDelta: 0,
                lastPlayedAt: ISO8601DateFormatter().string(from: Date())
            )
            try stat.insert(db)
        }
    }

    func recordSkip(trackId: Int64) throws {
        try dbPool.write { db in
            try db.execute(
                sql: "UPDATE tracks SET skipCount = skipCount + 1, lastSkippedAt = ? WHERE id = ?",
                arguments: [ISO8601DateFormatter().string(from: Date()), trackId]
            )
            let stat = PendingPlayStatRecord(
                trackId: trackId,
                playCountDelta: 0,
                skipCountDelta: 1,
                lastSkippedAt: ISO8601DateFormatter().string(from: Date())
            )
            try stat.insert(db)
        }
    }

    // MARK: - Search

    func searchTracks(query: String) throws -> [Track] {
        try dbPool.read { db in
            let pattern = "%\(query)%"
            let sql = """
                SELECT *, CASE
                    WHEN title LIKE ? THEN 1
                    WHEN artist LIKE ? OR albumArtist LIKE ? THEN 2
                    WHEN album LIKE ? THEN 3
                    ELSE 4
                END AS relevance
                FROM tracks
                WHERE title LIKE ? OR artist LIKE ? OR albumArtist LIKE ? OR album LIKE ?
                ORDER BY relevance, title
                LIMIT 200
                """
            return try TrackRecord.fetchAll(
                db, sql: sql,
                arguments: [pattern, pattern, pattern, pattern,
                            pattern, pattern, pattern, pattern]
            ).map { $0.toTrack() }
        }
    }

    // MARK: - Sync Operations

    func syncMetadataBatch(tracks: [SyncClient.SyncTrackMeta], playlists: [SyncClient.SyncPlaylistMeta]) throws {
        try dbPool.writeWithoutTransaction { db in
            try db.execute(sql: "PRAGMA foreign_keys = OFF")
            try db.execute(sql: "BEGIN IMMEDIATE TRANSACTION")

            for syncTrack in tracks {
                let record = TrackRecord(
                    id: syncTrack.id,
                    persistentId: syncTrack.persistentId,
                    title: syncTrack.title,
                    artist: syncTrack.artist,
                    albumArtist: syncTrack.albumArtist,
                    album: syncTrack.album,
                    genre: syncTrack.genre,
                    composer: syncTrack.composer,
                    year: syncTrack.year,
                    trackNumber: syncTrack.trackNumber,
                    trackCount: syncTrack.trackCount,
                    discNumber: syncTrack.discNumber,
                    discCount: syncTrack.discCount,
                    duration: syncTrack.duration,
                    size: syncTrack.size,
                    bitRate: syncTrack.bitRate,
                    sampleRate: syncTrack.sampleRate,
                    playCount: syncTrack.playCount ?? 0,
                    skipCount: syncTrack.skipCount ?? 0,
                    rating: syncTrack.rating,
                    loved: syncTrack.loved ?? false,
                    dateAdded: syncTrack.dateAdded,
                    lastPlayedAt: syncTrack.lastPlayedAt,
                    lastSkippedAt: syncTrack.lastSkippedAt,
                    artworkHash: syncTrack.artworkHash,
                    hasArtwork: syncTrack.hasArtwork,
                    mood: syncTrack.mood,
                    energy: syncTrack.energy,
                    vibeTags: syncTrack.vibeTags,
                    bpm: syncTrack.bpm,
                    danceability: syncTrack.danceability,
                    acousticness: syncTrack.acousticness,
                    aiTaggedAt: syncTrack.aiTaggedAt,
                    fileExtension: syncTrack.fileExtension
                )
                if try TrackRecord.fetchOne(db, key: syncTrack.id) != nil {
                    try db.execute(
                        sql: """
                            UPDATE tracks SET
                                persistentId = ?, title = ?, artist = ?, albumArtist = ?,
                                album = ?, genre = ?, composer = ?, year = ?,
                                trackNumber = ?, trackCount = ?, discNumber = ?, discCount = ?,
                                duration = ?, size = ?, bitRate = ?, sampleRate = ?,
                                playCount = ?, skipCount = ?, rating = ?, loved = ?,
                                dateAdded = ?, lastPlayedAt = ?, lastSkippedAt = ?,
                                artworkHash = ?, hasArtwork = ?,
                                mood = ?, energy = ?, vibeTags = ?, bpm = ?,
                                danceability = ?, acousticness = ?, aiTaggedAt = ?,
                                fileExtension = ?
                            WHERE id = ?
                            """,
                        arguments: [
                            record.persistentId, record.title, record.artist, record.albumArtist,
                            record.album, record.genre, record.composer, record.year,
                            record.trackNumber, record.trackCount, record.discNumber, record.discCount,
                            record.duration, record.size, record.bitRate, record.sampleRate,
                            record.playCount, record.skipCount, record.rating, record.loved,
                            record.dateAdded, record.lastPlayedAt, record.lastSkippedAt,
                            record.artworkHash, record.hasArtwork,
                            record.mood, record.energy, record.vibeTags, record.bpm,
                            record.danceability, record.acousticness, record.aiTaggedAt,
                            record.fileExtension,
                            record.id
                        ]
                    )
                } else {
                    try record.insert(db)
                }
            }

            for syncPlaylist in playlists {
                let record = PlaylistRecord(
                    id: syncPlaylist.id,
                    persistentId: syncPlaylist.persistentId,
                    name: syncPlaylist.name,
                    isSmart: syncPlaylist.isSmart,
                    isFolder: syncPlaylist.isFolder,
                    parentId: syncPlaylist.parentId,
                    sortOrder: syncPlaylist.sortOrder,
                    trackCount: syncPlaylist.trackCount
                )
                if try PlaylistRecord.fetchOne(db, key: syncPlaylist.id) != nil {
                    try db.execute(
                        sql: """
                            UPDATE playlists SET
                                persistentId = ?, name = ?, isSmart = ?, isFolder = ?,
                                parentId = ?, sortOrder = ?, trackCount = ?
                            WHERE id = ?
                            """,
                        arguments: [
                            record.persistentId, record.name, record.isSmart, record.isFolder,
                            record.parentId, record.sortOrder, record.trackCount,
                            record.id
                        ]
                    )
                } else {
                    try record.insert(db)
                }

                try db.execute(
                    sql: "DELETE FROM playlistTracks WHERE playlistId = ?",
                    arguments: [syncPlaylist.id]
                )
                for (index, trackId) in syncPlaylist.trackIds.enumerated() {
                    let ptRecord = PlaylistTrackRecord(
                        playlistId: syncPlaylist.id,
                        trackId: trackId,
                        position: index
                    )
                    try ptRecord.insert(db)
                }
            }

            let manifestTrackIds = tracks.map { $0.id }
            let manifestPlaylistIds = playlists.map { $0.id }

            if !manifestPlaylistIds.isEmpty {
                let plPlaceholders = manifestPlaylistIds.map { _ in "?" }.joined(separator: ",")
                try db.execute(
                    sql: "DELETE FROM playlistTracks WHERE playlistId NOT IN (\(plPlaceholders))",
                    arguments: StatementArguments(manifestPlaylistIds)
                )
                try db.execute(
                    sql: "DELETE FROM playlists WHERE id NOT IN (\(plPlaceholders))",
                    arguments: StatementArguments(manifestPlaylistIds)
                )
            }

            if !manifestTrackIds.isEmpty {
                let tkPlaceholders = manifestTrackIds.map { _ in "?" }.joined(separator: ",")
                try db.execute(
                    sql: "DELETE FROM playlistTracks WHERE trackId NOT IN (\(tkPlaceholders))",
                    arguments: StatementArguments(manifestTrackIds)
                )
                try db.execute(
                    sql: "DELETE FROM tracks WHERE id NOT IN (\(tkPlaceholders))",
                    arguments: StatementArguments(manifestTrackIds)
                )
            }

            try db.execute(sql: "COMMIT TRANSACTION")
            try db.execute(sql: "PRAGMA foreign_keys = ON")
        }
    }

    func fetchAndClearPendingPlayStats() throws -> [PendingPlayStatRecord] {
        try dbPool.write { db in
            let stats = try PendingPlayStatRecord.fetchAll(db)
            try db.execute(sql: "DELETE FROM pendingPlayStats")
            return stats
        }
    }

    // MARK: - Mock Data

    func seedMockDataIfEmpty() {
        do {
            let count = try dbPool.read { db in
                try TrackRecord.fetchCount(db)
            }
            guard count == 0 else { return }

            try insertTracks(MockData.tracks)
            for playlist in MockData.playlists {
                try insertPlaylist(playlist)
            }
            for (playlistId, trackIds) in MockData.playlistTrackIds {
                try insertPlaylistTracks(playlistId, trackIds: trackIds)
            }
            print("Seeded database with mock data")
        } catch {
            print("Failed to seed mock data: \(error)")
        }
    }

    // MARK: - Info

    func trackCount() throws -> Int {
        try dbPool.read { db in
            try TrackRecord.fetchCount(db)
        }
    }
}
