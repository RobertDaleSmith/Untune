import Foundation

struct Track: Codable, Identifiable, Hashable {
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
    // iOS-specific
    var localFilePath: String?
    var fileDownloaded: Bool

    var displayArtist: String {
        artist ?? albumArtist ?? "Unknown Artist"
    }

    var displayAlbum: String {
        album ?? "Unknown Album"
    }

    var formattedDuration: String {
        guard let duration else { return "--:--" }
        return TimeFormatting.format(seconds: duration)
    }
}
