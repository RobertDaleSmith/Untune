import Foundation

enum SyncState: String {
    case idle
    case discovering
    case connecting
    case syncingMetadata
    case syncingArtwork
    case syncingFiles
    case uploadingPlayStats
    case done
    case error
}

@Observable
class SyncEngine {
    private(set) var state: SyncState = .idle
    private(set) var progress: SyncProgress = SyncProgress()
    private(set) var errorMessage: String?

    private let pairingManager: PairingManager
    private let db = DatabaseManager.shared

    struct SyncProgress {
        var totalTracks = 0
        var downloadedTracks = 0
        var totalArtwork = 0
        var downloadedArtwork = 0
        var phase: String = ""
    }

    init(pairingManager: PairingManager) {
        self.pairingManager = pairingManager
    }

    func startSync() async {
        guard pairingManager.isPaired,
              let baseURL = pairingManager.baseURL,
              let token = pairingManager.authToken() else {
            state = .error
            errorMessage = "Not paired with desktop"
            return
        }

        let client = SyncClient(baseURL: baseURL, authToken: token)
        state = .syncingMetadata
        progress = SyncProgress()
        errorMessage = nil

        do {
            // 1. Fetch manifest
            progress.phase = "Fetching library..."
            print("[Sync] Fetching manifest...")
            let manifest = try await client.fetchManifest()
            print("[Sync] Got \(manifest.tracks.count) tracks, \(manifest.playlists.count) playlists")

            // 2. Sync metadata to local DB
            progress.phase = "Updating metadata..."
            progress.totalTracks = manifest.tracks.count
            try syncMetadata(manifest)
            print("[Sync] Metadata synced")

            // 3. Download artwork
            state = .syncingArtwork
            let artworkHashes = Set(manifest.tracks.compactMap { $0.artworkHash })
            progress.totalArtwork = artworkHashes.count
            progress.downloadedArtwork = 0
            progress.phase = "Downloading artwork..."
            print("[Sync] Downloading \(artworkHashes.count) artwork files...")

            let artworkToDownload = artworkHashes.filter { hash in
                !FileManager.default.fileExists(atPath: artworkFileURL(hash: hash).path)
            }
            progress.totalArtwork = artworkToDownload.count
            let artworkErrors = await downloadConcurrently(
                items: Array(artworkToDownload),
                concurrency: 8
            ) { hash in
                let artworkURL = self.artworkFileURL(hash: hash)
                try await client.downloadArtwork(hash: hash, to: artworkURL)
            } onProgress: {
                self.progress.downloadedArtwork += 1
            }
            print("[Sync] Artwork done (\(artworkErrors) errors)")

            // 4. Download audio files (only tracks that have files on desktop)
            state = .syncingFiles
            progress.downloadedTracks = 0
            progress.phase = "Downloading tracks..."

            let tracksToDownload = manifest.tracks.filter { track in
                guard let ext = track.fileExtension else { return false }
                let fileURL = audioFileURL(trackId: track.id, ext: ext)
                return !FileManager.default.fileExists(atPath: fileURL.path)
            }
            progress.totalTracks = tracksToDownload.count
            print("[Sync] Downloading \(tracksToDownload.count) audio files (\(manifest.tracks.count - tracksToDownload.count) skipped/already downloaded)...")

            let downloadErrors = await downloadConcurrently(
                items: tracksToDownload,
                concurrency: 6
            ) { track in
                let ext = track.fileExtension ?? "m4a"
                let fileURL = self.audioFileURL(trackId: track.id, ext: ext)
                try await client.downloadTrackFile(trackId: track.id, to: fileURL)
                try self.db.updateTrackFilePath(trackId: track.id, localPath: fileURL.path)
            } onProgress: {
                self.progress.downloadedTracks += 1
                if self.progress.downloadedTracks % 50 == 0 {
                    print("[Sync] Downloaded \(self.progress.downloadedTracks)/\(tracksToDownload.count) tracks")
                }
            }
            print("[Sync] Audio files done (\(downloadErrors) errors)")

            // 5. Upload play stats
            state = .uploadingPlayStats
            progress.phase = "Uploading play stats..."
            print("[Sync] Uploading play stats...")
            try await uploadPendingPlayStats(client: client)

            // 6. Mark complete
            print("[Sync] Marking sync complete...")
            let trackIds = manifest.tracks.map { $0.id }
            let playlistIds = manifest.playlists.map { $0.id }
            try await client.markSyncComplete(trackIds: trackIds, playlistIds: playlistIds)

            state = .done
            progress.phase = "Sync complete"
            print("[Sync] Complete!")

        } catch {
            state = .error
            errorMessage = error.localizedDescription
            print("[Sync] FAILED at phase '\(progress.phase)': \(error)")
        }
    }

    // MARK: - Metadata Sync

    private func syncMetadata(_ manifest: SyncClient.SyncManifest) throws {
        try db.syncMetadataBatch(tracks: manifest.tracks, playlists: manifest.playlists)
    }

    // MARK: - Play Stats Upload

    private func uploadPendingPlayStats(client: SyncClient) async throws {
        let stats = try db.fetchAndClearPendingPlayStats()
        guard !stats.isEmpty else { return }

        let deltas = stats.map { stat in
            SyncClient.PlayStatsDelta(
                trackId: stat.trackId,
                playCountDelta: stat.playCountDelta,
                skipCountDelta: stat.skipCountDelta,
                lastPlayedAt: stat.lastPlayedAt,
                lastSkippedAt: stat.lastSkippedAt
            )
        }
        try await client.uploadPlayStats(deltas)
    }

    // MARK: - Concurrent Downloads

    /// Downloads items concurrently with a limit, returns error count.
    private func downloadConcurrently<T: Sendable>(
        items: [T],
        concurrency: Int,
        operation: @Sendable @escaping (T) async throws -> Void,
        onProgress: @escaping @MainActor () -> Void
    ) async -> Int {
        var errorCount = 0

        await withTaskGroup(of: Bool.self) { group in
            var iterator = items.makeIterator()

            // Seed initial batch
            for _ in 0..<concurrency {
                guard let item = iterator.next() else { break }
                group.addTask {
                    do {
                        try await operation(item)
                        return true
                    } catch {
                        print("[Sync] Download error: \(error)")
                        return false
                    }
                }
            }

            // As each completes, count result and add next item
            for await success in group {
                if !success { errorCount += 1 }
                await MainActor.run { onProgress() }

                if let item = iterator.next() {
                    group.addTask {
                        do {
                            try await operation(item)
                            return true
                        } catch {
                            print("[Sync] Download error: \(error)")
                            return false
                        }
                    }
                }
            }
        }

        return errorCount
    }

    // MARK: - File Paths

    private func audioFileURL(trackId: Int64, ext: String) -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("Music/\(trackId).\(ext)")
    }

    private func artworkFileURL(hash: String) -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("Artwork/\(hash).jpg")
    }
}
