import Foundation

/// Handles HTTP communication with the desktop sync server
class SyncClient {
    private let baseURL: String
    private let authToken: String
    private let session: URLSession

    init(baseURL: String, authToken: String) {
        self.baseURL = baseURL
        self.authToken = authToken
        self.session = URLSession.shared
    }

    // MARK: - Sync Manifest

    struct SyncManifest: Codable {
        let playlists: [SyncPlaylistMeta]
        let tracks: [SyncTrackMeta]
    }

    struct SyncPlaylistMeta: Codable {
        let id: Int64
        let persistentId: String
        let name: String
        let isSmart: Bool
        let isFolder: Bool
        let parentId: Int64?
        let sortOrder: Int
        let trackCount: Int
        let trackIds: [Int64]
    }

    struct SyncTrackMeta: Codable {
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
        let playCount: Int?
        let skipCount: Int?
        let rating: Int?
        let loved: Bool?
        let dateAdded: String?
        let lastPlayedAt: String?
        let lastSkippedAt: String?
        let artworkHash: String?
        let hasArtwork: Bool
        let mood: String?
        let energy: Int?
        let vibeTags: String?
        let bpm: Int?
        let danceability: Int?
        let acousticness: Int?
        let aiTaggedAt: String?
        let updatedAt: String?
        let fileExtension: String?
    }

    func fetchManifest() async throws -> SyncManifest {
        let data = try await get("/api/sync/manifest")
        return try JSONDecoder().decode(SyncManifest.self, from: data)
    }

    // MARK: - Artwork Downloads

    func downloadArtwork(hash: String, to destinationURL: URL) async throws {
        let data = try await get("/api/artwork/\(hash)")
        let fm = FileManager.default
        try fm.createDirectory(at: destinationURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: destinationURL)
    }

    // MARK: - Streaming URL

    /// Build a streaming URL for a track, suitable for AVURLAsset
    func streamingURL(forTrackId trackId: Int64) -> URL {
        URL(string: "\(baseURL)/api/tracks/\(trackId)/file")!
    }

    /// Auth headers for AVURLAsset HTTP streaming
    var streamingHeaders: [String: String] {
        ["Authorization": "Bearer \(authToken)"]
    }

    // MARK: - Play Stats Upload

    struct PlayStatsDelta: Codable {
        let trackId: Int64
        let playCountDelta: Int
        let skipCountDelta: Int
        let lastPlayedAt: String?
        let lastSkippedAt: String?
    }

    func uploadPlayStats(_ stats: [PlayStatsDelta]) async throws {
        let body = ["stats": stats]
        let data = try JSONEncoder().encode(body)
        try await post("/api/sync/play-stats", body: data)
    }

    // MARK: - Sync Complete

    func markSyncComplete(trackIds: [Int64], playlistIds: [Int64]) async throws {
        struct CompleteReq: Codable {
            let syncedTrackIds: [Int64]
            let syncedPlaylistIds: [Int64]
        }
        let body = try JSONEncoder().encode(CompleteReq(syncedTrackIds: trackIds, syncedPlaylistIds: playlistIds))
        try await post("/api/sync/complete", body: body)
    }

    // MARK: - HTTP Helpers

    private func makeRequest(_ path: String) -> URLRequest {
        let url = URL(string: "\(baseURL)\(path)")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func get(_ path: String) async throws -> Data {
        let request = makeRequest(path)
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw SyncError.requestFailed
        }
        return data
    }

    @discardableResult
    private func post(_ path: String, body: Data) async throws -> Data {
        var request = makeRequest(path)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw SyncError.requestFailed
        }
        return data
    }
}

enum SyncError: LocalizedError {
    case requestFailed
    case notPaired

    var errorDescription: String? {
        switch self {
        case .requestFailed: return "Request to desktop failed"
        case .notPaired: return "Not paired with desktop"
        }
    }
}
