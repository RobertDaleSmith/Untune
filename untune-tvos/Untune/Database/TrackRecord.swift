import GRDB

struct TrackRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "tracks"

    let id: Int64
    let persistentId: String?
    let title: String
    let artist: String?
    let albumArtist: String?
    let album: String?
    let genre: String?
    let composer: String?
    let year: Int?
    let trackNumber: Int?
    let trackCount: Int?
    let discNumber: Int?
    let discCount: Int?
    let duration: Double?
    let size: Int64?
    let bitRate: Int?
    let sampleRate: Int?
    var playCount: Int
    var skipCount: Int
    let rating: Int?
    let loved: Bool
    let dateAdded: String?
    var lastPlayedAt: String?
    var lastSkippedAt: String?
    let artworkHash: String?
    let hasArtwork: Bool
    let mood: String?
    let energy: Int?
    let vibeTags: String?
    let bpm: Int?
    let danceability: Int?
    let acousticness: Int?
    let aiTaggedAt: String?
    let fileExtension: String?

    func toTrack() -> Track {
        Track(
            id: id,
            persistentId: persistentId,
            title: title,
            artist: artist,
            albumArtist: albumArtist,
            album: album,
            genre: genre,
            composer: composer,
            year: year,
            trackNumber: trackNumber,
            trackCount: trackCount,
            discNumber: discNumber,
            discCount: discCount,
            duration: duration,
            size: size,
            bitRate: bitRate,
            sampleRate: sampleRate,
            playCount: playCount,
            skipCount: skipCount,
            rating: rating,
            loved: loved,
            dateAdded: dateAdded,
            lastPlayedAt: lastPlayedAt,
            lastSkippedAt: lastSkippedAt,
            artworkHash: artworkHash,
            hasArtwork: hasArtwork,
            mood: mood,
            energy: energy,
            vibeTags: vibeTags,
            bpm: bpm,
            danceability: danceability,
            acousticness: acousticness,
            aiTaggedAt: aiTaggedAt,
            fileExtension: fileExtension
        )
    }

    static func from(_ track: Track) -> TrackRecord {
        TrackRecord(
            id: track.id,
            persistentId: track.persistentId,
            title: track.title,
            artist: track.artist,
            albumArtist: track.albumArtist,
            album: track.album,
            genre: track.genre,
            composer: track.composer,
            year: track.year,
            trackNumber: track.trackNumber,
            trackCount: track.trackCount,
            discNumber: track.discNumber,
            discCount: track.discCount,
            duration: track.duration,
            size: track.size,
            bitRate: track.bitRate,
            sampleRate: track.sampleRate,
            playCount: track.playCount,
            skipCount: track.skipCount,
            rating: track.rating,
            loved: track.loved,
            dateAdded: track.dateAdded,
            lastPlayedAt: track.lastPlayedAt,
            lastSkippedAt: track.lastSkippedAt,
            artworkHash: track.artworkHash,
            hasArtwork: track.hasArtwork,
            mood: track.mood,
            energy: track.energy,
            vibeTags: track.vibeTags,
            bpm: track.bpm,
            danceability: track.danceability,
            acousticness: track.acousticness,
            aiTaggedAt: track.aiTaggedAt,
            fileExtension: track.fileExtension
        )
    }
}
